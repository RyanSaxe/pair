import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { adapters } from "../../src/hub/wake.mjs";
import { settings } from "../../src/shared/settings.mjs";
import { agentsScratch, orphan, outsideAgents } from "../support/agents.mjs";
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
// arguments under a stand-in for Claude Code or Codex in the background and
// exits. The stand-in is a process named for the command, claude or codex,
// that runs in the folder that -C names, as Codex does, or else in the
// script's folder, runs the pair command its prompt asks for and exits. On
// Windows the script reads each of its arguments as a string, as the
// spawn.ps1 example in docs/guides/advanced-setup.md does.
async function terminal({ home, env }) {
  const bin = path.join(home, "bin");
  await fs.mkdir(bin);
  const clis = {
    claude: {
      executable: await agentExecutable(bin, "claude"),
      env: {
        CLAUDE_CODE_MESSAGING_SOCKET: path.join(bin, "none.sock"),
        CLAUDE_CODE_MESSAGING_TOKEN: "test",
        CLAUDE_CODE_SESSION_ID: "spawned",
      },
    },
    codex: {
      executable: await agentExecutable(bin, "codex"),
      env: {
        CODEX_HOME: path.join(bin, "codex-home"),
        CODEX_THREAD_ID: "spawned",
      },
    },
  };
  const agent = path.join(bin, "agent.js");
  await fs.writeFile(
    agent,
    `process.title = process.argv[2];
const [, command] = /^In your own shell, run pair (.+?) first\\./.exec(process.argv.at(-1));
require("node:child_process").spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(pair)}, ...command.split(" ")], { stdio: "ignore" });
`,
  );
  const start = path.join(bin, "terminal.js");
  await fs.writeFile(
    start,
    `const [directory, command, ...args] = process.argv.slice(2);
const cli = ${JSON.stringify(clis)}[command];
const cd = args.indexOf("-C");
const agent = require("node:child_process").spawn(cli.executable, [${JSON.stringify(agent)}, command, ...args], {
  cwd: cd === -1 ? directory : args[cd + 1],
  detached: true,
  stdio: "ignore",
  windowsHide: true,
  env: { ...process.env, ...cli.env },
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
      ? `$words = @($args | ForEach-Object { [string]$_ })\n& ${quoted(process.execPath)} ${quoted(start)} @words\nexit $LASTEXITCODE\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${start}" "$@"\n`;
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.writeFile(script, text, { mode: 0o755 });
}

// A person runs pair spawn in a terminal, with no agent CLI among its parent
// processes, so pair spawn registers no session there and prints nothing about
// one.
test("pair spawn outside any agent CLI runs the launch script with the CLI's command line, with the arguments after -- before the first prompt, and prints only the name the new session registers", async (t) => {
  const context = await scratch(t);
  const { env, folder, home, runs } = context;
  await terminal(context);
  const api = await folder("api");

  const args = ["--dir", api, "--name", "api-fix"];
  const prompt = ["--prompt", "Fix the checkout test."];
  // Windows runs the launch script with powershell.exe -File, which must pass
  // on whole a word that starts with - and contains a colon, as a path does.
  const forwarded = ["--", "--model", "sonnet", "--settings=C:\\pair.json"];
  const spawned = await orphan(
    home,
    ["spawn", "claude", ...args, ...prompt, ...forwarded],
    { ...outsideAgents, ...env },
  );
  assert.deepEqual(spawned, {
    stdout: `Started api-fix (Claude Code) in ${path.join("~", "api")}. Message it with: pair message --to api-fix --text "…"\n`,
    stderr: "",
  });
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
        "--model",
        "sonnet",
        "--settings=C:\\pair.json",
        "--",
        "In your own shell, run pair register --name api-fix first. If another running session has that name, run pair register without --name. Fix the checkout test.",
      ],
    },
  );
  // Windows refuses to remove the working directory or the executable of a
  // running process, so the stand-in exits before the test's directory goes.
  await waitUntil(() => !alive(run.pid));
});

// Each CLI reads its options before its prompt.
// A flag that takes several values, such as Claude Code's --add-dir, takes
// every word after it until one that ends the options or starts another flag.
test("every adapter's launch puts the forwarded arguments, in order, among the CLI's options, and the prompt where no forwarded flag can take it", () => {
  const args = ["--add-dir", "a folder"];
  for (const [harness, adapter] of Object.entries(adapters)) {
    const command = adapter.launch({
      name: "api-fix",
      prompt: "Say hi.",
      args,
    });
    const at = command.indexOf("--add-dir");
    const prompt = command.indexOf("Say hi.");
    assert.ok(at > 0, harness);
    assert.ok(!command.slice(0, prompt - 1).includes("--"), harness);
    assert.deepEqual(command.slice(at, at + args.length), args, harness);
    assert.ok(at + args.length < prompt, harness);
    assert.ok(["--", "-i", "--prompt"].includes(command[prompt - 1]), harness);
  }
});

// Codex starts a session that a -c override other than a feature names
// without its app-server daemon, and the hub can then only queue a message for
// the end of the session's turn. With -C, the session runs and registers in
// another folder than --dir, and pair spawn finds it by its name.
test("pair spawn passes the arguments after -- to Codex before the first prompt, finds the named session in the folder they choose, and warns about one that starts Codex without its daemon", async (t) => {
  const context = await scratch(t);
  const { env, folder, home, runs } = context;
  await terminal(context);
  const api = await folder("api");
  const tree = await folder("api-tree");

  const forwarded = [
    "-m",
    "gpt-5.5",
    "-C",
    tree,
    "-c",
    "model_reasoning_effort=high",
  ];
  const spawned = await orphan(
    home,
    ["spawn", "codex", "--dir", api, "--name", "api-fix", "--", ...forwarded],
    { ...outsideAgents, ...env },
  );
  assert.deepEqual(spawned, {
    stdout: `Started api-fix (Codex) in ${path.join("~", "api-tree")}. Message it with: pair message --to api-fix --text "…"\n`,
    stderr:
      "pair: With -c model_reasoning_effort=high, Codex starts the session without its app-server daemon, so the session reads a message that arrives during a turn only when the turn ends.\n",
  });
  const [run] = await runs();
  assert.deepEqual(run.args, [
    api,
    "codex",
    ...forwarded,
    "--",
    "In your own shell, run pair register --name api-fix first. If another running session has that name, run pair register without --name.",
  ]);
  await waitUntil(() => !alive(run.pid));
});

// The agent spawns the new session in its own folder, so the agent's own new
// entry is also an entry of that CLI in that folder.
test("pair spawn inside an agent session registers that session, prints the new session's name, not that one, and refuses that session's name for --name", async (t) => {
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

  // A running session has that name, so pair spawn runs no launch script.
  const taken = await sender.run(["spawn", "claude", "--name", listed.name]);
  assert.deepEqual(taken, {
    status: 1,
    stdout: "",
    stderr: `pair: The running session claude-code:sender in ${path.join("~", "app")} is named ${listed.name}. Give another --name.\n`,
  });
  assert.equal((await runs()).length, 1);
});

// pair spawn reads its own flags only before --, so a --help after it is the
// CLI's, and a flag for the CLI before it is refused with where it belongs.
test("pair spawn refuses a flag of the CLI given before --, and passes a --help after -- to the CLI", async (t) => {
  const { spawn } = await scratch(t);
  for (const flag of ["--model", "-m"]) {
    const refused = await spawn("claude", flag, "sonnet");
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /Give it after -- to pass it to the CLI\./);
  }
  const forwarded = await spawn("claude", "--", "--help");
  assert.equal(forwarded.code, 1);
  assert.match(forwarded.stderr, /^pair: pair spawn needs a launch script/);
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
