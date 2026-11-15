import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { settings } from "../../src/shared/settings.mjs";
import { outsideAgents } from "../support/agents.mjs";
import {
  agentExecutable,
  alive,
  exec,
  literal,
  pair,
  waitUntil,
} from "../support/hub.mjs";

// The test's directory is pair spawn's home, so pair prints the test's folders
// under ~ on every platform.
async function scratch(t) {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pair-spawn-")),
  );
  const env = {
    ...outsideAgents,
    HOME: home,
    USERPROFILE: home,
    XDG_STATE_HOME: path.join(home, "state"),
    XDG_CONFIG_HOME: path.join(home, "config"),
    PAIR_HUB_PORT: "0",
  };
  const runs = async () =>
    (await fs.readFile(path.join(home, "runs"), "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  // Windows refuses to remove the working directory or the executable of a
  // running process, so the stand-ins stop before the test's directory goes.
  t.after(async () => {
    for (const { pid } of await runs()) {
      if (alive(pid)) process.kill(pid);
      await waitUntil(() => !alive(pid), 3000);
    }
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5 });
  });
  const spawn = (...args) =>
    exec(process.execPath, [pair, "spawn", ...args], { cwd: home, env });
  return { home, env, runs, spawn };
}

// terminal writes a launch script that plays a terminal: it records the folder
// it runs in, its arguments and the process it starts, then starts the CLI's
// arguments under a stand-in for Claude Code in the background and exits. The
// stand-in is a process named claude that runs the pair command its prompt
// asks for, and stays until the test ends.
async function terminal({ home, env }) {
  const bin = path.join(home, "bin");
  await fs.mkdir(bin);
  const claude = await agentExecutable(bin, "claude");
  const agent = path.join(bin, "agent.js");
  await fs.writeFile(
    agent,
    `process.title = "claude";
const [, command] = /^Run pair (.+?) first\\./.exec(process.argv.at(-1));
require("node:child_process").spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(pair)}, ...command.split(" ")], { stdio: "ignore" });
setTimeout(() => {}, 60_000);
`,
  );
  const start = path.join(bin, "terminal.js");
  await fs.writeFile(
    start,
    `const [directory, , ...args] = process.argv.slice(2);
const agent = require("node:child_process").spawn(${JSON.stringify(claude)}, [${JSON.stringify(agent)}, ...args], {
  cwd: directory,
  detached: true,
  stdio: "ignore",
  windowsHide: true,
  env: {
    ...process.env,
    CLAUDE_CODE_MESSAGING_SOCKET: ${JSON.stringify(path.join(bin, "none.sock"))},
    CLAUDE_CODE_MESSAGING_TOKEN: "test",
    CLAUDE_CODE_SESSION_ID: "spawned",
  },
});
agent.unref();
const run = { cwd: process.cwd(), args: process.argv.slice(2), pid: agent.pid };
require("node:fs").appendFileSync(${JSON.stringify(path.join(home, "runs"))}, JSON.stringify(run) + "\\n");
`,
  );
  const script = settings(env).launchScript;
  const quoted = (text) => `'${text.replaceAll("'", "''")}'`;
  const text =
    process.platform === "win32"
      ? `& ${quoted(process.execPath)} ${quoted(start)} @args\nexit $LASTEXITCODE\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${start}" "$@"\n`;
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.writeFile(script, text, { mode: 0o755 });
}

test("pair spawn runs the launch script with the CLI's command line, and prints the name the new session registers", async (t) => {
  const context = await scratch(t);
  const { home, runs, spawn } = context;
  await terminal(context);
  const folder = path.join(home, "api");
  await fs.mkdir(folder);

  const { stdout } = await spawn(
    "claude",
    "--dir",
    "api",
    "--name",
    "api-fix",
    "--prompt",
    "Fix the checkout test.",
  );
  assert.equal(
    stdout,
    `Started api-fix (Claude Code) in ${path.join("~", "api")}. Message it with: pair message --to api-fix --text "…"\n`,
  );
  const [run] = await runs();
  assert.deepEqual(
    { cwd: run.cwd, args: run.args },
    {
      cwd: folder,
      args: [
        folder,
        "claude",
        "--name",
        "api-fix",
        "Run pair register --name api-fix first. Fix the checkout test.",
      ],
    },
  );
});

test("pair spawn refuses without a launch script", async (t) => {
  const { spawn } = await scratch(t);
  const script = path.basename(settings().launchScript);
  await assert.rejects(spawn("claude", "--prompt", "Say hello."), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, "");
    assert.match(
      error.stderr,
      new RegExp(
        `^pair: pair spawn needs a launch script at ${literal(path.join("~", "config", "pair", script))}\\. pair runs it as ${literal(script)} DIR COMMAND ARG…, and the script opens a terminal in DIR that runs the command\\. `,
      ),
    );
    return true;
  });
});
