import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import * as claudeCode from "../../adapters/claude-code/wake.mjs";
import * as codex from "../../adapters/codex/wake.mjs";
import * as copilot from "../../adapters/copilot/wake.mjs";
import * as opencode from "../../adapters/opencode/wake.mjs";
import * as pi from "../../adapters/pi/wake.mjs";
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
// detectWake uses the nearest ancestor process that an adapter recognizes,
// because an agent CLI started inside another one inherits the outer CLI's
// variables. ancestors returns each process's executable name.
function ancestors(pid = process.ppid) {
  const chain = [];
  for (let current = pid; current > 1;) {
    let line;
    try {
      // ps prints its own error when it fails, as Git for Windows' ps does
      // for -o, so ancestors discards its stderr to keep the error out of the
      // command's output.
      line = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(current)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      break;
    }
    const match = /^(\d+)\s+(.*)$/.exec(line);
    if (!match) break;
    chain.push({ pid: current, command: path.basename(match[2].trim()) });
    current = Number(match[1]);
  }
  return chain;
}
// The hub can wake an agent CLI's session only when every one of the
// adapter's variables is set, so detectWake throws adapter.unwakeable when
// one is missing.
export function detectWake(env = process.env, tools = { ancestors }) {
  for (const ancestor of [...tools.ancestors(), null])
    for (const adapter of Object.values(adapters)) {
      const claimed = ancestor
        ? ancestor.command === adapter.command
        : Boolean(env[adapter.variables[0]]);
      if (!claimed) continue;
      if (!adapter.variables.every((name) => env[name]))
        throw new Error(adapter.unwakeable);
      return adapter.detect(env, { ...tools, ancestor });
    }
  requireValue(
    false,
    "pair found no agent CLI it can wake. It works inside Claude Code, Codex, Copilot CLI, pi or opencode, and none of their session variables is set here. Tell the user, and stop.",
  );
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
