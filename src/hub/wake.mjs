import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import * as claudeCode from "../../adapters/claude-code/wake.mjs";
import * as codex from "../../adapters/codex/wake.mjs";
import * as copilot from "../../adapters/copilot/wake.mjs";
import * as opencode from "../../adapters/opencode/wake.mjs";
import * as pi from "../../adapters/pi/wake.mjs";
import { requireValue } from "../shared/util.mjs";

// Each agent CLI wakes through its adapter, keyed by the harness name a wake
// target carries. With no agent CLI among the ancestors, the first adapter
// whose variables are set decides, in this order.
export const adapters = {
  copilot,
  codex,
  "claude-code": claudeCode,
  pi,
  opencode,
};
// The holder is the agent the hub wakes, named the way its adapter tells
// one session of its agent CLI from another.
export const identify = (target) => ({
  harness: target.harness,
  id: adapters[target.harness].identity(target),
});
// The nearest ancestor process that an adapter recognizes decides which
// session start belongs to, because an agent CLI started inside another
// inherits the outer one's variables. Names are the executables.
function ancestors(pid = process.ppid) {
  const chain = [];
  for (let current = pid; current > 1;) {
    let line;
    try {
      // ps writes its own error when it cannot run, as Git's ps on Windows
      // does for -o, so its stderr stays out of the command's output.
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
// An agent CLI claims the environment when it is the ancestor asked about
// or, asked about the variables alone, when its first variable is set. Its
// session can be woken only with every one of its variables.
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
    "no wake path. This needs Claude Code, Codex, Copilot, pi or opencode, and none of their session variables is set.",
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
// agent that started the hub is not woken for every test submission. The
// hub passes its config, and a caller with none gets wakes on.
export async function wakeRunner(target, line, { wake = true, log } = {}) {
  if (!wake) {
    (log || console.log)(`wake off, not sent: ${line}`);
    return;
  }
  return adapters[target.harness].wake(target, line, run);
}
