import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { settings } from "../src/session.mjs";

const exec = promisify(execFile);
const pair = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));

// pair takes its wake target and its identity from the nearest agent CLI
// among its ancestors. These commands run under a process named claude whose
// inbox socket nobody listens on, so a test wake reaches no real session, and
// the suite passes the same way under Claude Code, Codex, Copilot CLI or none
// of them.
export async function pairCli(home, extra = {}, cli = pair) {
  const relay =
    'const { status } = require("node:child_process").spawnSync(process.execPath, process.argv.slice(1), { stdio: "inherit" }); process.exitCode = status ?? 1;';
  const claude = path.join(home, "claude");
  await fs.symlink(process.execPath, claude);
  const env = {
    ...process.env,
    XDG_STATE_HOME: home,
    CLAUDE_CODE_MESSAGING_SOCKET: path.join(home, "none.sock"),
    CLAUDE_CODE_MESSAGING_TOKEN: "test",
    ...extra,
  };
  const run = async (...args) =>
    (await exec(claude, ["-e", relay, cli, ...args], { env })).stdout;
  return {
    config: settings(env),
    run,
    agent: { harness: "claude-code", id: env.CLAUDE_CODE_MESSAGING_SOCKET },
  };
}
