import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Codex runs shell commands in a sandbox with no sockets and no writes
// outside the workspace. An allow rule for pair, in a file of pair's own,
// runs its commands outside the sandbox without a prompt.
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const rulesFile = path.join(codexHome, "rules", "pair.rules");
const rules =
  'prefix_rule(pattern=["pair"], decision="allow", justification="pair: the command talks to its local hub and writes the session under the state directory")\n';
const rulesPresent = () =>
  fs
    .readFile(rulesFile, "utf8")
    .then((text) => text === rules)
    .catch(() => false);
export async function writeRules() {
  try {
    await fs.mkdir(path.dirname(rulesFile), { recursive: true });
    await fs.writeFile(rulesFile, rules, { mode: 0o600 });
  } catch (error) {
    throw error.code === "EPERM" && process.env.CODEX_SANDBOX
      ? new Error(
          `writing ${rulesFile} is itself outside the sandbox: run this command escalated, once`,
        )
      : error;
  }
  console.log(JSON.stringify({ rules: rulesFile, written: true }, null, 2));
}
// pair check reports the rule wherever Codex runs or is installed.
export async function codexReport(env = process.env) {
  const codex =
    Boolean(env.CODEX_SANDBOX) ||
    (await fs.stat(codexHome).then(
      () => true,
      () => false,
    ));
  if (!codex) return null;
  return {
    rules: rulesFile,
    present: await rulesPresent(),
    write: "pair check --codex-rules",
  };
}
// Codex sets CODEX_SANDBOX for every command, bypassed or not, so only a
// real refusal from the sandbox earns the advice.
export const sandboxAdvice =
  "run this command outside the sandbox (escalated), and run `pair check --codex-rules` once so an allow rule keeps Codex from asking again";
export function withSandboxHint(message, env = process.env) {
  if (!env.CODEX_SANDBOX || !/\bEPERM\b/.test(message)) return message;
  return `${message}. The sandbox blocked it: ${sandboxAdvice}`;
}
// pair check itself needs the socket and the state directory, so its advice
// names the rule it writes.
export function checkRefusal(error, env = process.env) {
  return error.code === "EPERM" && env.CODEX_SANDBOX
    ? new Error(
        `the Codex sandbox blocks the hub's socket and its state directory. Run outside the sandbox (escalated): pair check --codex-rules, which writes ${rulesFile} so a command made only of pair calls runs without asking. Then run the check again.`,
      )
    : error;
}
