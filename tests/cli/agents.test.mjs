import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findAgent } from "../../src/cli/agents.mjs";
import { settings } from "../../src/shared/settings.mjs";
import { outsideAgents, standIn } from "../support/agents.mjs";
import { codexDaemon } from "../support/codex.mjs";
import { exec, killHub, literal, pair } from "../support/hub.mjs";

async function scratch(t) {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pair-agents-")),
  );
  const env = { XDG_STATE_HOME: path.join(home, "state"), PAIR_HUB_PORT: "0" };
  const started = [];
  // Windows refuses to remove the working directory or the executable of a
  // running process, so the stand-ins and the hub stop before the test's
  // directory goes, and rm retries while Windows releases them.
  t.after(async () => {
    for (const agent of started) await agent.kill();
    await killHub(settings(env));
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5 });
  });
  const list = path.join(env.XDG_STATE_HOME, "pair", "agents");
  return {
    list,
    folder: async (name) => {
      const directory = path.join(home, name);
      await fs.mkdir(directory);
      return directory;
    },
    agent: async (cwd, options = {}) => {
      const agent = await standIn(t, {
        home,
        cwd,
        ...options,
        env: { ...env, ...options.env },
      });
      started.push(agent);
      return agent;
    },
    // pair agents runs outside any agent CLI.
    agents: async () =>
      JSON.parse(
        (
          await exec(process.execPath, [pair, "agents", "--json"], {
            env: { ...outsideAgents, ...env },
          })
        ).stdout,
      ).agents,
    // copy writes another running session's entry, for a session that a test
    // does not need to start.
    copy: async (file, fields) => {
      const entry = JSON.parse(await fs.readFile(path.join(list, file)));
      await fs.writeFile(
        path.join(list, `${fields.id.replace(":", "-")}.json`),
        JSON.stringify({ ...entry, ...fields }),
      );
    },
  };
}

// The stand-in's home is the test's directory, so pair prints the test's
// folders under ~.
const shown = (name) => path.join("~", name);

test("pair register names a session for its folder, and gives it the same name after its CLI restarts", async (t) => {
  const { list, folder, agent, agents } = await scratch(t);
  const directory = await folder("Fix Login");
  const git = (...args) =>
    exec("git", args, { cwd: directory, env: outsideAgents });
  await git("init", "--quiet", "-b", "fix-login");
  const { stdout: top } = await git("rev-parse", "--show-toplevel");
  assert.equal(await fs.realpath(top.trim()), await fs.realpath(directory));
  const sessionId = "6f1c2a9e-0d1b-4c8e-9a51-2f6b7d1e9c30";
  const env = { CLAUDE_CODE_SESSION_ID: sessionId };
  const first = await agent(directory, { env });

  const registered = await first.run(["register"]);
  assert.equal(registered.status, 0, registered.stderr);
  const [, name] = registered.stdout.match(
    /^Registered (fix-login-[0-9a-f]{2}),/,
  );
  assert.equal(
    registered.stdout,
    `Registered ${name}, claude-code:6f1c2a9e, in ${shown("Fix Login")}.\n`,
  );
  const [header, row] = (await first.run(["agents"])).stdout.split("\n");
  assert.deepEqual(header.split(/ {2,}/), [
    "NAME",
    "CLI",
    "DIRECTORY",
    "BRANCH",
    "ID",
  ]);
  assert.deepEqual(row.split(/ {2,}/), [
    name,
    "Claude Code",
    shown("Fix Login"),
    "fix-login",
    "claude-code:6f1c2a9e",
  ]);
  const [entry] = await agents();
  assert.deepEqual(
    {
      ...entry,
      processStart: typeof entry.processStart,
      registeredAt: typeof entry.registeredAt,
    },
    {
      id: `claude-code:${sessionId}`,
      name,
      cli: "claude-code",
      directory,
      branch: "fix-login",
      pid: first.pid,
      processStart: "string",
      runningCheck: "process",
      registeredAt: "string",
    },
  );
  // The entry has Claude Code's inbox token, so only the user can read it.
  // Windows has no file modes.
  const file = path.join(list, `claude-code-${sessionId}.json`);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(list)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  }
  assert.equal(JSON.parse(await fs.readFile(file)).target.token, "test");

  // claude --resume keeps the session ID and starts a new process, and pair
  // agents deletes the entry of the process that exited.
  await first.kill();
  assert.deepEqual(await agents(), []);
  const resumed = await agent(directory, { env });
  assert.equal((await resumed.run(["register"])).stdout, registered.stdout);
});

test("a session whose name a running session has gets the next one, and --name refuses a taken name", async (t) => {
  const { folder, agent } = await scratch(t);
  const shop = await folder("shop");
  // The hashes of these two sessions' IDs start with the same byte, 72.
  const first = await agent(shop, { env: { CLAUDE_CODE_SESSION_ID: "first" } });
  const second = await agent(shop, {
    env: { CLAUDE_CODE_SESSION_ID: "second-30" },
  });
  const named = async (agent, ...args) =>
    JSON.parse((await agent.run(["register", "--json", ...args])).stdout).name;
  assert.equal(await named(first), "shop-72");
  assert.equal(await named(second), "shop-73");

  assert.deepEqual(await second.run(["register", "--name", "shop-72"]), {
    status: 1,
    stdout: "",
    stderr: `pair: The running session claude-code:first in ${shown("shop")} is named shop-72. Give another --name.\n`,
  });
  assert.equal(await named(second, "--name", "till"), "till");
  assert.equal(await named(second), "till");
});

test("pair agents deletes the entry of a CLI that exited and of a process ID that a new process has", async (t) => {
  const { list, folder, agent, agents, copy } = await scratch(t);
  const directory = await folder("api");
  const exits = await agent(directory, {
    env: { CLAUDE_CODE_SESSION_ID: "exits" },
  });
  const stays = await agent(directory, {
    env: { CLAUDE_CODE_SESSION_ID: "stays" },
  });
  assert.equal((await exits.run(["register"])).status, 0);
  assert.equal((await stays.run(["register"])).status, 0);
  // After a restart, a new process can have the process ID of a session's CLI.
  await copy("claude-code-stays.json", {
    id: "claude-code:reused",
    name: "reused",
    pid: process.pid,
    processStart: "Thu Jan  1 00:00:00 1970",
  });
  await exits.kill();
  assert.deepEqual(
    (await agents()).map((entry) => entry.id),
    ["claude-code:stays"],
  );
  assert.deepEqual(await fs.readdir(list), ["claude-code-stays.json"]);
});

test("pair register --hook reads Codex's thread ID from stdin, and exits 0 when it cannot register", async (t) => {
  const { folder, agent, agents } = await scratch(t);
  const directory = await folder("api");
  const codex = await agent(directory, { harness: "codex" });
  const hook = await codex.run(["register", "--hook"], {
    input: JSON.stringify({
      session_id: "0199c1d4-1111-7000-8000-000000000000",
      hook_event_name: "SessionStart",
    }),
  });
  assert.equal(hook.status, 0, hook.stderr);
  assert.match(
    hook.stdout,
    new RegExp(
      `^Registered api-[0-9a-f]{2}, codex:0199c1d4, in ${literal(shown("api"))}\\.\n$`,
    ),
  );

  const unregistered =
    "pair: Tell the user that this Codex session exports no CODEX_THREAD_ID, so the hub cannot wake it, and stop.\n";
  assert.deepEqual(await codex.run(["register", "--hook"]), {
    status: 0,
    stdout: "",
    stderr: unregistered,
  });
  assert.deepEqual(await codex.run(["register"]), {
    status: 1,
    stdout: "",
    stderr: unregistered,
  });

  // Codex's thread IDs start with the time, so two threads started together
  // share their first characters, and pair prints enough of each to tell them
  // apart.
  const other = await agent(directory, {
    harness: "codex",
    env: { CODEX_THREAD_ID: "0199c1d4-2222-7000-8000-000000000000" },
  });
  assert.equal((await other.run(["register"])).status, 0);
  const table = (await other.run(["agents"])).stdout;
  assert.deepEqual(
    table
      .split("\n")
      .slice(1, -1)
      .map((line) => line.split(/ {2,}/).at(-1)),
    ["codex:0199c1d4-2", "codex:0199c1d4-1"],
  );
  assert.equal((await agents()).length, 2);
});

// Codex 0.169 started with no -c override runs every session's thread, and
// each command, on one app-server daemon, which keeps running after a session
// exits and unloads the session's thread about a minute later. The codex
// stand-ins here play the daemon's process.
test(
  "pair agents lists a Codex session on the daemon while the daemon has its thread loaded, and refuses its subagent",
  {
    skip:
      process.platform === "win32" &&
      "codexDaemon listens on a Unix socket path, and Node on Windows listens only on a named pipe",
  },
  async (t) => {
    const { folder, agent, agents, list } = await scratch(t);
    const parent = "01a1db96-49bd-7b21-a768-1907c3bd40ff";
    const subagent = "01a1db97-0000-7000-8000-000000000000";
    let status = "idle";
    const daemon = await codexDaemon(
      t,
      {
        "thread/read": ({ threadId }) => ({
          thread: {
            id: threadId,
            status: { type: status },
            source:
              threadId === subagent
                ? {
                    subAgent: {
                      thread_spawn: {
                        parent_thread_id: parent,
                        agent_nickname: "reviewer",
                      },
                    },
                  }
                : "cli",
          },
        }),
      },
      { inCodexHome: true },
    );
    const directory = await folder("api");
    const codex = (thread) =>
      agent(directory, {
        harness: "codex",
        env: { CODEX_THREAD_ID: thread, CODEX_HOME: daemon.home },
      });
    const registered = await (await codex(parent)).run(["register", "--json"]);
    assert.equal(registered.status, 0, registered.stderr);
    const { name, runningCheck } = JSON.parse(registered.stdout);
    assert.equal(runningCheck, "loaded");
    assert.deepEqual(await (await codex(subagent)).run(["register"]), {
      status: 1,
      stdout: "",
      stderr: `pair: This Codex session is a subagent, so pair lists only the session that started it. Reach it through that session as ${name}/reviewer.\n`,
    });
    assert.deepEqual(
      (await agents()).map((entry) => entry.id),
      [`codex:${parent}`],
    );
    status = "notLoaded";
    assert.deepEqual(await agents(), []);
    assert.deepEqual(await fs.readdir(list), []);
  },
);

test("pair start registers its agent, and starts the session when it cannot register it", async (t) => {
  const { folder, agent, agents } = await scratch(t);
  const directory = await folder("app");
  const registered = await agent(directory, {
    env: { CLAUDE_CODE_SESSION_ID: "started" },
  });
  const started = await registered.run(["start", "--title", "Test"]);
  assert.equal(started.status, 0, started.stderr);
  assert.equal(started.stderr, "");
  assert.deepEqual(
    (await agents()).map((entry) => [entry.id, entry.pid]),
    [["claude-code:started", registered.pid]],
  );

  const unregistered = await agent(directory);
  const second = await unregistered.run(["start", "--title", "Test", "--json"]);
  assert.equal(second.status, 0, second.stderr);
  assert.ok(JSON.parse(second.stdout).sessionDir);
  assert.equal(
    second.stderr,
    "pair: This agent is not registered, so pair agents does not list it. Claude Code set no session ID for this command, so pair has no ID to list the session under.\n",
  );
  assert.equal((await agents()).length, 1);
});

test("findAgent finds a session by name, by ID, or by the start of one ID", () => {
  const api = { id: "codex:0199c1d4-1111", name: "api-a0" };
  const web = { id: "codex:0199c1d4-2222", name: "web-11" };
  const entries = [api, web];
  assert.equal(findAgent(entries, "web-11"), web);
  assert.equal(findAgent(entries, "codex:0199c1d4-1111"), api);
  assert.equal(findAgent(entries, "codex:0199c1d4-2"), web);
  assert.equal(findAgent(entries, "shop-ea"), null);
  assert.throws(() => findAgent(entries, "codex:0199c1d4"), {
    message:
      "codex:0199c1d4 is the start of the IDs of 2 sessions, api-a0 (codex:0199c1d4-1111) and web-11 (codex:0199c1d4-2222). Give the session's name or more of its ID.",
  });
});
