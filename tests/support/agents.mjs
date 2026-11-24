import { isolateConfig } from "./env.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { settings } from "../../src/shared/settings.mjs";
import {
  agentExecutable,
  alive,
  exec,
  killHub,
  pair,
  waitUntil,
} from "./hub.mjs";

isolateConfig();

// outsideAgents is this process's environment without the variables by which
// pair finds an agent CLI, and without git's, which a test run inside an agent
// CLI or a git hook would otherwise pass on.
export const outsideAgents = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(ANTIGRAVITY|CLAUDE|CODEX|COPILOT|PAIR|PI|OPENCODE)_|^GIT_/.test(key),
  ),
);

// pair finds an agent CLI among a command's parent processes, and the test
// itself may run inside one. orphan therefore runs pair ARGS from a node
// process that exits at once, so the system adopts the command before pair
// reads its parent processes. orphan waits for the command to exit, and
// returns its stdout and stderr, which it writes to files in home.
export async function orphan(home, args, env) {
  const output = path.join(home, `orphan-${crypto.randomUUID()}`);
  const start = `const fs = require("node:fs");
const stdio = ["ignore", fs.openSync(${JSON.stringify(`${output}.out`)}, "w"), fs.openSync(${JSON.stringify(`${output}.err`)}, "w")];
const child = require("node:child_process").spawn(process.execPath, ${JSON.stringify([pair, ...args])}, { detached: true, windowsHide: true, stdio });
process.stdout.write(String(child.pid));
child.unref();`;
  const { stdout } = await exec(process.execPath, ["-e", start], { env });
  assert.ok(await waitUntil(() => !alive(Number(stdout)), 30_000));
  const read = (suffix) => fs.readFile(`${output}${suffix}`, "utf8");
  return { stdout: await read(".out"), stderr: await read(".err") };
}

// The stand-in runs each command it receives as its child and sends back the
// command's exit status and output. With PAIR_TEST_LISTEN, it also listens on
// that port of 127.0.0.1, as copilot --ui-server does. A command given no input reads an empty
// stdin. Node 24 on Linux names its main thread MainThread, which ps then
// prints as the process's command, so the stand-in sets its title to its own
// name. It runs pair with this process's Node, because Windows locks the
// stand-in's executable while a process started from it runs, such as the hub
// that pair start starts.
const relay = (name) => `
process.title = ${JSON.stringify(name)};
const { spawnSync } = require("node:child_process");
const port = Number(process.env.PAIR_TEST_LISTEN);
if (port) require("node:net").createServer().listen(port, "127.0.0.1");
process.on("message", ({ args, input, env }) => {
  const { status, stdout, stderr } = spawnSync(${JSON.stringify(process.execPath)}, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    ...(input === null ? { stdio: ["ignore", "pipe", "pipe"] } : { input }),
  });
  process.send({ status, stdout, stderr });
});`;

// standIn starts a process named for harness, claude for Claude Code, that
// runs until the test ends or kill() stops it, and runs each pair command as
// its child, as an agent CLI runs its agent's commands. A Claude Code stand-in
// has an inbox socket with no listener unless env gives one, so no command
// reaches a real session, and a Codex stand-in has a CODEX_HOME with no
// daemon. run(args, { input, env }) writes input to the command's stdin, adds
// env to the command's environment, and returns { status, stdout, stderr }.
export async function standIn(t, { home, cwd, harness = "claude-code", env }) {
  const name =
    { "claude-code": "claude", antigravity: "agy" }[harness] ?? harness;
  const bin = path.join(home, `bin-${crypto.randomUUID()}`);
  await fs.mkdir(bin);
  const executable = await agentExecutable(bin, name);
  const own = {
    "claude-code": {
      CLAUDE_CODE_MESSAGING_SOCKET: path.join(bin, "none.sock"),
      CLAUDE_CODE_MESSAGING_TOKEN: "test",
    },
    codex: { CODEX_HOME: path.join(bin, "codex-home") },
  }[harness];
  const child = spawn(executable, ["-e", relay(name)], {
    cwd,
    // The stand-in's home is the test's directory, so pair prints the test's
    // folders under ~ on every platform.
    env: { ...outsideAgents, HOME: home, USERPROFILE: home, ...own, ...env },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  await once(child, "spawn");
  const exited = once(child, "exit");
  const kill = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  };
  t.after(kill);
  return {
    pid: child.pid,
    run: (args, { input = null, env: change } = {}) => {
      const answer = once(child, "message").then(([result]) => result);
      child.send({ args: [pair, ...args], input, env: change });
      return answer;
    },
    kill,
  };
}

// listAgents returns what pair agents --json lists in the state directory of
// env, run outside any agent CLI.
const listAgents = async (env) =>
  JSON.parse(
    (
      await exec(process.execPath, [pair, "agents", "--json"], {
        env: { ...outsideAgents, ...env },
      })
    ).stdout,
  ).agents;

// listed waits until agents() lists at least count sessions, for a session
// that pi's extension or opencode's plugin registers without waiting, and
// returns each one's ID and process ID, the most recently registered first.
export async function listed(agents, count = 1) {
  let entries = [];
  await waitUntil(
    async () => (entries = await agents()).length >= count,
    30_000,
  );
  return entries.map(({ id, pid }) => ({ id, pid }));
}

// agentsScratch gives a test a home and a state directory of its own, in
// env. folder(name) creates a folder in the home, agent(cwd, { harness, env })
// starts a stand-in there, outside(args, env) runs pair outside any agent CLI,
// and agents() returns what pair agents --json lists. Windows refuses to
// remove the working directory or the executable of a running process, so the
// stand-ins and any hub stop before the home goes, and rm retries while
// Windows releases them.
export async function agentsScratch(t) {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pair-agents-")),
  );
  const env = { XDG_STATE_HOME: path.join(home, "state"), PAIR_HUB_PORT: "0" };
  const started = [];
  t.after(async () => {
    for (const agent of started) await agent.kill();
    await killHub(settings(env));
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5 });
  });
  return {
    home,
    env,
    list: path.join(env.XDG_STATE_HOME, "pair", "agents"),
    folder: async (name) => {
      const directory = path.join(home, name);
      await fs.mkdir(directory, { recursive: true });
      return directory;
    },
    agent: async (cwd, { harness, env: extra } = {}) => {
      const agent = await standIn(t, {
        home,
        cwd,
        harness,
        env: { ...env, ...extra },
      });
      started.push(agent);
      return agent;
    },
    outside: (args, extra = {}) =>
      exec(process.execPath, [pair, ...args], {
        env: { ...outsideAgents, ...env, ...extra },
      }).catch((error) => error),
    agents: () => listAgents(env),
  };
}

// pi's extension and opencode's plugins run in the CLI's own process, and a
// test that loads them plays the CLI in this process. inProcessState gives
// this process a state directory of its own until the test ends, and returns
// a folder for the session and agents(), which returns what pair agents
// --json lists.
export async function inProcessState(t) {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pair-in-process-")),
  );
  const saved = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = path.join(home, "state");
  t.after(async () => {
    if (saved === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = saved;
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5 });
  });
  const state = { XDG_STATE_HOME: process.env.XDG_STATE_HOME };
  return { home, agents: () => listAgents(state) };
}
