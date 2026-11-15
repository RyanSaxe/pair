import { execFile } from "node:child_process";
import * as claudeCode from "../../adapters/claude-code/wake.mjs";
import * as codex from "../../adapters/codex/wake.mjs";
import * as copilot from "../../adapters/copilot/wake.mjs";
import * as opencode from "../../adapters/opencode/wake.mjs";
import * as pi from "../../adapters/pi/wake.mjs";
import { ancestors, processTable } from "../shared/processes.mjs";
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
// Every session command runs detectWake, so it reads the processes with ps
// alone, and finds no ancestors on Windows or where ps cannot run.
function sessionAncestors() {
  if (process.platform === "win32") return [];
  try {
    return ancestors(processTable());
  } catch {
    return [];
  }
}
// An adapter recognizes an ancestor that runs its command, whose ID is in the
// adapter's pidVariable, which pi's extension and opencode's plugin set, or
// that the adapter's own recognizes accepts, as Copilot's accepts node running
// Copilot's script. That one reads the command line, so detectAgent asks it
// only about an ancestor that no adapter recognizes by name or ID.
const named = (adapter, ancestor, env) =>
  ancestor.command === adapter.command ||
  ancestor.pid === Number(env[adapter.pidVariable]);
export const recognizes = (adapter, ancestor, env = process.env) =>
  named(adapter, ancestor, env) || Boolean(adapter.recognizes?.(ancestor));
// detectAgent uses the nearest ancestor that an adapter recognizes, because an
// agent CLI started inside another one inherits the outer CLI's variables, or
// else the first adapter whose first variable is set. The hub can wake a
// session only when every one of the adapter's variables is set, so it throws
// adapter.unwakeable when one is missing. hookInput, the JSON on a start
// hook's stdin, fills in a variable the hook's environment lacks. detectAgent
// returns null in a plain terminal, and detectWake throws there.
export function detectAgent(
  env = process.env,
  tools = { ancestors: sessionAncestors },
  hookInput = null,
) {
  const list = Object.values(adapters);
  for (const ancestor of [...tools.ancestors(), null]) {
    const adapter = ancestor
      ? (list.find((each) => named(each, ancestor, env)) ??
        list.find((each) => each.recognizes?.(ancestor)))
      : list.find((each) => env[each.variables[0]]);
    if (!adapter) continue;
    const seen = {
      ...(hookInput && adapter.hookVariables?.(hookInput)),
      ...env,
    };
    if (!adapter.variables.every((name) => seen[name]))
      throw new Error(adapter.unwakeable);
    return adapter.detect(seen, { ...tools, ancestor });
  }
  return null;
}
export function detectWake(env, tools, hookInput) {
  const target = detectAgent(env, tools, hookInput);
  requireValue(
    target,
    "pair found no agent CLI it can wake. It works inside Claude Code, Codex, Copilot CLI, pi or opencode, and none of their session variables is set here. Tell the user, and stop.",
  );
  return target;
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
