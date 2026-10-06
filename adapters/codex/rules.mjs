import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Codex runs shell commands in a sandbox with no sockets and no writes
// outside the workspace. An allow rule for pair, in a file of pair's own,
// runs its commands outside the sandbox without a prompt.
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export const rulesFile = path.join(codexHome, "rules", "pair.rules");
export const rules =
  'prefix_rule(pattern=["pair"], decision="allow", justification="pair: the command talks to its local hub and writes the session under the state directory")\n';
const rulesText = () => fs.readFile(rulesFile, "utf8").catch(() => null);
// pair start needs the file to exist. A rule the user edited passes.
export const rulesExist = async () => (await rulesText()) !== null;
// pair setup-codex writes the rule and returns the file's path.
export async function writeRules() {
  try {
    await fs.mkdir(path.dirname(rulesFile), { recursive: true });
    await fs.writeFile(rulesFile, rules, { mode: 0o600 });
  } catch (error) {
    throw error.code === "EPERM" && process.env.CODEX_SANDBOX
      ? new Error(
          `Writing ${rulesFile} needs access outside the sandbox. Run pair setup-codex once, escalated.`,
        )
      : error;
  }
  return rulesFile;
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
  const text = await rulesText();
  return {
    rules: rulesFile,
    exists: text !== null,
    present: text === rules,
    write: "pair setup-codex",
  };
}
// Codex sets CODEX_SANDBOX for every command, bypassed or not, so only a
// real refusal from the sandbox earns the advice.
export const sandboxAdvice =
  "Run this command outside the sandbox (escalated), and run `pair setup-codex` once so that Codex stops asking.";
export function withSandboxHint(message, env = process.env) {
  if (!env.CODEX_SANDBOX || !/\bEPERM\b/.test(message)) return message;
  return `${message}. The Codex sandbox blocked it. ${sandboxAdvice}`;
}
// pair check itself needs the socket and the state directory, so its advice
// names the rule it writes.
export function checkRefusal(error, env = process.env) {
  return error.code === "EPERM" && env.CODEX_SANDBOX
    ? new Error(
        `the Codex sandbox blocks the hub's socket and its state directory. Run pair setup-codex once, outside the sandbox (escalated). It writes ${rulesFile}, and Codex then runs any command made only of pair calls without asking. Then run pair check again.`,
      )
    : error;
}
