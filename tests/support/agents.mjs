import "./env.mjs";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentExecutable, exec, pair } from "./hub.mjs";

// outsideAgents is this process's environment without the variables by which
// pair finds an agent CLI, and without git's, which a test run inside an agent
// CLI or a git hook would otherwise pass on.
export const outsideAgents = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(CLAUDE|CODEX|COPILOT|PAIR|PI|OPENCODE)_|^GIT_/.test(key),
  ),
);

// The stand-in runs each command it receives as its child and sends back the
// command's exit status and output. A command given no input reads an empty
// stdin. Node 24 on Linux names its main thread MainThread, which ps then
// prints as the process's command, so the stand-in sets its title to its own
// name. It runs pair with this process's Node, because Windows locks the
// stand-in's executable while a process started from it runs, such as the hub
// that pair start starts.
const relay = (name) => `
process.title = ${JSON.stringify(name)};
const { spawnSync } = require("node:child_process");
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
  const name = harness === "claude-code" ? "claude" : harness;
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
  const agents = async () =>
    JSON.parse(
      (
        await exec(process.execPath, [pair, "agents", "--json"], {
          env: { ...outsideAgents, XDG_STATE_HOME: process.env.XDG_STATE_HOME },
        })
      ).stdout,
    ).agents;
  return { home, agents };
}
