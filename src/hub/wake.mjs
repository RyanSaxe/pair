import { execFile } from "node:child_process";
import * as claudeCode from "../../adapters/claude-code/wake.mjs";
import * as codex from "../../adapters/codex/wake.mjs";
import * as copilot from "../../adapters/copilot/wake.mjs";
import * as opencode from "../../adapters/opencode/wake.mjs";
import * as pi from "../../adapters/pi/wake.mjs";
import { ancestors } from "../shared/processes.mjs";
import { requireValue } from "../shared/util.mjs";

// When no agent CLI is among the ancestor processes, detectWake picks the
// first adapter in this order whose variables are set.
export const adapters = {
  copilot,
  codex,
  "claude-code": claudeCode,
  pi,
  opencode,
};
export const identify = (target) => ({
  harness: target.harness,
  id: adapters[target.harness].identity(target),
});
// detectAgent uses the nearest ancestor process that an adapter recognizes,
// because an agent CLI started inside another one inherits the outer CLI's
// variables. The hub can wake an agent CLI's session only when every one of
// the adapter's variables is set, so detectAgent throws adapter.unwakeable
// when one is missing. hookInput is the JSON that a CLI's start hook reads on
// stdin, which fills in a variable the CLI leaves out of the hook's
// environment.
//
// detectAgent returns the wake target and the process ID of the agent CLI,
// which is null when no ancestor process is the CLI. It returns null in a
// plain terminal, where no ancestor process is an agent CLI and none of the
// adapters' variables is set, and detectWake throws there.
export function detectAgent(
  env = process.env,
  tools = { ancestors },
  hookInput = null,
) {
  for (const ancestor of [...tools.ancestors(), null])
    for (const adapter of Object.values(adapters)) {
      const claimed = ancestor
        ? ancestor.command === adapter.command
        : Boolean(env[adapter.variables[0]]);
      if (!claimed) continue;
      const seen = {
        ...(hookInput && adapter.hookVariables?.(hookInput)),
        ...env,
      };
      if (!adapter.variables.every((name) => seen[name]))
        throw new Error(adapter.unwakeable);
      return {
        target: adapter.detect(seen, { ...tools, ancestor }),
        pid: ancestor?.pid ?? null,
      };
    }
  return null;
}
export function detectWake(env, tools, hookInput) {
  const detected = detectAgent(env, tools, hookInput);
  requireValue(
    detected,
    "pair found no agent CLI it can wake. It works inside Claude Code, Codex, Copilot CLI, pi or opencode, and none of their session variables is set here. Tell the user, and stop.",
  );
  return detected;
}
function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve();
    });
  });
}
// A hub started with PAIR_WAKE=off, such as a scratch hub for checking the
// frame, writes each wake line to its log instead of sending it, so the
// agent that started the hub is not woken for every test submission. A
// caller that passes no options gets wakes on.
export async function wakeRunner(target, line, { wake = true, log } = {}) {
  if (!wake) {
    (log || console.log)(`wake off, not sent: ${line}`);
    return;
  }
  return adapters[target.harness].wake(target, line, run);
}
