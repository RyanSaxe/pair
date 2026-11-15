import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { settings } from "../../src/shared/settings.mjs";
import { agentsScratch } from "../support/agents.mjs";
import {
  agentExecutable,
  alive,
  literal,
  pair,
  waitUntil,
} from "../support/hub.mjs";

// pair spawn runs outside any agent CLI, with the test's directory as its home,
// so pair prints the test's folders under ~ on every platform.
async function scratch(t) {
  const context = await agentsScratch(t);
  const env = {
    ...context.env,
    HOME: context.home,
    USERPROFILE: context.home,
    XDG_CONFIG_HOME: path.join(context.home, "config"),
  };
  const runs = async () =>
    (await fs.readFile(path.join(context.home, "runs"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const spawn = (...args) => context.outside(["spawn", ...args], env);
  return { ...context, env, runs, spawn };
}

// terminal writes a launch script that plays a terminal: it records the folder
// it runs in, its arguments and the process it starts, then starts the CLI's
// arguments under a stand-in for Claude Code in the background and exits. The
// stand-in is a process named claude that runs the pair command its prompt
// asks for and exits.
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
  const { folder, runs, spawn } = context;
  await terminal(context);
  const api = await folder("api");

  const { stdout } = await spawn(
    "claude",
    "--dir",
    api,
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
      cwd: api,
      args: [
        api,
        "claude",
        "--name",
        "api-fix",
        "Run pair register --name api-fix first. Fix the checkout test.",
      ],
    },
  );
  // Windows refuses to remove the working directory or the executable of a
  // running process, so the stand-in exits before the test's directory goes.
  await waitUntil(() => !alive(run.pid));
});

// The agent spawns the new session in its own folder, so the agent's own new
// entry is also an entry of that CLI in that folder.
test("pair spawn inside an agent session registers that session, and prints the new session's name, not that one", async (t) => {
  const context = await scratch(t);
  const { agent, agents, env, folder, runs } = context;
  await terminal(context);
  const sender = await agent(await folder("app"), {
    env: {
      CLAUDE_CODE_SESSION_ID: "sender",
      XDG_CONFIG_HOME: env.XDG_CONFIG_HOME,
    },
  });

  const spawned = await sender.run(["spawn", "claude"]);
  assert.equal(spawned.status, 0, spawned.stderr);
  const [run] = await runs();
  await waitUntil(() => !alive(run.pid));
  const listed = (await agents()).find(
    (entry) => entry.id === "claude-code:sender",
  );
  assert.ok(listed, "pair agents lists the session that ran pair spawn");
  const [, name] = new RegExp(
    `^Started (app-[0-9a-f]{2}) \\(Claude Code\\) in ${literal(path.join("~", "app"))}\\.`,
  ).exec(spawned.stdout);
  assert.notEqual(name, listed.name);
});

test("pair spawn refuses without a launch script", async (t) => {
  const { spawn } = await scratch(t);
  const script = path.basename(settings().launchScript);
  const refused = await spawn("claude", "--prompt", "Say hello.");
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, "");
  assert.match(
    refused.stderr,
    new RegExp(
      `^pair: pair spawn needs a launch script at ${literal(path.join("~", "config", "pair", script))}\\. pair runs it as ${literal(script)} DIR COMMAND ARG…, and the script opens a terminal in DIR that runs the command\\. `,
    ),
  );
});
