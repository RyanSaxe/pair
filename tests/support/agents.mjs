import "./env.mjs";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { agentExecutable, pair } from "./hub.mjs";

// outsideAgents is this process's environment without the variables by which
// pair finds an agent CLI and a scratch hub, and without git's, which a test
// inside an agent CLI or a git hook would otherwise pass on.
export const outsideAgents = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(CLAUDE|CODEX|COPILOT|PAIR|PI)_|^GIT_/.test(key),
  ),
);

// The stand-in runs each command it receives as its child and sends back the
// command's exit status and output. A command given no input reads /dev/null.
// The stand-in keeps running while its IPC channel is open. Node 24 on Linux
// names its main thread MainThread, which ps then prints as the process's
// command, so the stand-in sets its title to its own name. It runs pair with
// this process's Node, because Windows locks the stand-in's executable while a
// process started from it runs, such as the hub that pair start starts.
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

// standIn starts a process named claude, or codex with harness "codex", that
// runs until the test ends or kill() stops it, and runs each pair command as
// its child, as an agent CLI runs its agent's commands. pair register finds
// the stand-in among the command's parent processes and records its process.
// A Claude Code stand-in has an inbox socket with no listener, so no command
// reaches a real session. run(args, { input, env }) writes input to the
// command's stdin, which is /dev/null without it, adds env to the command's
// environment, and returns { status, stdout, stderr }.
export async function standIn(t, { home, cwd, harness = "claude-code", env }) {
  const name = harness === "codex" ? "codex" : "claude";
  const bin = path.join(home, `bin-${crypto.randomUUID()}`);
  await fs.mkdir(bin);
  const executable = await agentExecutable(bin, name);
  // A Codex stand-in's CODEX_HOME has no daemon unless the test starts one.
  const inbox =
    harness === "codex"
      ? { CODEX_HOME: path.join(bin, "codex-home") }
      : {
          CLAUDE_CODE_MESSAGING_SOCKET: path.join(bin, "none.sock"),
          CLAUDE_CODE_MESSAGING_TOKEN: "test",
        };
  const child = spawn(executable, ["-e", relay(name)], {
    cwd,
    // The stand-in's home is the test's directory, so pair prints the test's
    // folders under ~ on every platform. Windows keeps its temporary folders
    // under the user's home, and other systems do not.
    env: { ...outsideAgents, HOME: home, USERPROFILE: home, ...inbox, ...env },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  await once(child, "spawn");
  const exited = once(child, "exit");
  t.after(() => child.kill());
  return {
    pid: child.pid,
    run: (args, { input = null, env: change } = {}) => {
      const answer = once(child, "message").then(([result]) => result);
      child.send({ args: [pair, ...args], input, env: change });
      return answer;
    },
    kill: async () => {
      child.kill();
      await exited;
    },
  };
}
