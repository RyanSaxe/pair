import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findAgent } from "../../src/cli/agents.mjs";
import { settings } from "../../src/shared/settings.mjs";
import { standIn } from "../support/agents.mjs";
import { codexDaemon } from "../support/codex.mjs";
import { exec, killHub, literal, pair } from "../support/hub.mjs";

// Git passes GIT_DIR to hooks and to the commands git rebase -x runs, and
// GIT_DIR would point git in this test at pair's own repository.
const withoutGit = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

async function scratch(t) {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pair-agents-")),
  );
  const env = { XDG_STATE_HOME: path.join(home, "state"), PAIR_HUB_PORT: "0" };
  t.after(async () => {
    await killHub(settings(env));
    await fs.rm(home, { recursive: true, force: true });
  });
  const list = path.join(env.XDG_STATE_HOME, "pair", "agents");
  return {
    home,
    env,
    list,
    folder: async (name) => {
      const directory = path.join(home, name);
      await fs.mkdir(directory);
      return directory;
    },
    agent: (cwd, options = {}) =>
      standIn(t, { home, cwd, ...options, env: { ...env, ...options.env } }),
    // pair agents runs outside any agent CLI.
    agents: async () =>
      JSON.parse(
        (
          await exec(process.execPath, [pair, "agents", "--json"], {
            env: { ...withoutGit, ...env },
          })
        ).stdout,
      ).agents,
    // copy writes another running session's entry, for a session that a test
    // does not need to start.
    copy: async (file, fields) => {
      const entry = JSON.parse(await fs.readFile(path.join(list, file)));
      const name = `${fields.id.replace(":", "-")}.json`;
      await fs.writeFile(
        path.join(list, name),
        JSON.stringify({ ...entry, ...fields }),
      );
    },
  };
}

test("pair register names a session for its folder and keeps the name, and pair agents lists it", async (t) => {
  const { list, folder, agent, agents } = await scratch(t);
  const directory = await folder("Fix Login");
  const git = (...args) =>
    exec("git", args, { cwd: directory, env: withoutGit });
  await git("init", "--quiet", "-b", "fix-login");
  const { stdout: top } = await git("rev-parse", "--show-toplevel");
  assert.equal(await fs.realpath(top.trim()), await fs.realpath(directory));
  const sessionId = "6f1c2a9e-0d1b-4c8e-9a51-2f6b7d1e9c30";
  const a = await agent(directory, {
    env: { CLAUDE_CODE_SESSION_ID: sessionId },
  });

  const first = await a.run(["register"]);
  assert.equal(first.status, 0, first.stderr);
  const [, name] = first.stdout.match(/^Registered (fix-login-[0-9a-f]{2}),/);
  // The stand-in's home is the test's directory.
  const shown = path.join("~", "Fix Login");
  assert.equal(
    first.stdout,
    `Registered ${name}, claude-code:6f1c2a9e, in ${shown}.\n`,
  );
  assert.equal((await a.run(["register"])).stdout, first.stdout);

  const [header, row, ...rest] = (await a.run(["agents"])).stdout.split("\n");
  const cells = [
    name,
    "Claude Code",
    shown,
    "fix-login",
    "claude-code:6f1c2a9e",
  ];
  assert.deepEqual(header.split(/ {2,}/), [
    "NAME",
    "CLI",
    "DIRECTORY",
    "BRANCH",
    "ID",
  ]);
  assert.deepEqual(row.split(/ {2,}/), cells);
  // Each cell starts under its column's label.
  const starts = (line, texts) => {
    let from = 0;
    return texts.map((text) => {
      const at = line.indexOf(text, from);
      from = at + text.length;
      return at;
    });
  };
  assert.deepEqual(
    starts(row, cells),
    starts(header, ["NAME", "CLI", "DIRECTORY", "BRANCH", "ID"]),
  );
  assert.deepEqual(rest, [""]);

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
      pid: a.pid,
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
});

test("a new session draws a name no running session has, and --name refuses a taken name", async (t) => {
  const { folder, agent, agents, copy } = await scratch(t);
  const shop = await folder("shop");
  const a = await agent(shop, { env: { CLAUDE_CODE_SESSION_ID: "first" } });
  assert.equal((await a.run(["register", "--name", "shop-00"])).status, 0);
  // Running sessions take every other name for shop but shop-ff.
  for (let n = 1; n < 255; n++) {
    const hex = n.toString(16).padStart(2, "0");
    await copy("claude-code-first.json", {
      id: `claude-code:copy-${hex}`,
      name: `shop-${hex}`,
    });
  }
  const b = await agent(shop, { env: { CLAUDE_CODE_SESSION_ID: "second" } });
  assert.equal(
    JSON.parse((await b.run(["register", "--json"])).stdout).name,
    "shop-ff",
  );

  const refused = await b.run(["register", "--name", "shop-00"]);
  assert.equal(refused.status, 1);
  assert.equal(
    refused.stderr,
    `pair: The running session claude-code:first in ${path.join("~", "shop")} is named shop-00. Give another --name.\n`,
  );
  assert.equal((await b.run(["register", "--name", "till"])).status, 0);
  assert.equal(
    (await b.run(["register"])).stdout,
    `Registered till, claude-code:second, in ${path.join("~", "shop")}.\n`,
  );
  const names = (await agents()).map((entry) => entry.name);
  assert.equal(names.length, 256);
  assert.equal(names[0], "till");
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
    processStart: "1970-01-01T00:00:00.000Z",
  });
  // macOS's ps refuses a process ID above its largest, and an entry with one
  // leaves the other entries listed.
  await copy("claude-code-stays.json", {
    id: "claude-code:corrupt",
    name: "corrupt",
    pid: 99999999,
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
  const thread = "0199c1d4-1111-7000-8000-000000000000";
  const hook = await codex.run(["register", "--hook"], {
    input: JSON.stringify({
      session_id: thread,
      hook_event_name: "SessionStart",
    }),
  });
  assert.equal(hook.status, 0, hook.stderr);
  assert.match(
    hook.stdout,
    new RegExp(
      `^Registered api-[0-9a-f]{2}, codex:0199c1d4, in ${literal(path.join("~", "api"))}\\.\n$`,
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
// stand-in here plays the daemon's process.
test(
  "pair agents lists a Codex session on the daemon while the daemon has its thread loaded",
  {
    skip:
      process.platform === "win32" &&
      "codexDaemon listens on a Unix socket path, and Node on Windows listens only on a named pipe",
  },
  async (t) => {
    const { folder, agent, agents, list } = await scratch(t);
    const thread = "01a1db96-49bd-7b21-a768-1907c3bd40ff";
    let status = "idle";
    const daemon = await codexDaemon(
      t,
      {
        "thread/read": ({ threadId }) => ({
          thread: { id: threadId, status: { type: status } },
        }),
      },
      { inCodexHome: true },
    );
    const codex = await agent(await folder("api"), {
      harness: "codex",
      env: { CODEX_THREAD_ID: thread, CODEX_HOME: daemon.home },
    });
    const registered = await codex.run(["register", "--json"]);
    assert.equal(registered.status, 0, registered.stderr);
    assert.equal(JSON.parse(registered.stdout).runningCheck, "loaded");
    assert.deepEqual(
      (await agents()).map((entry) => entry.id),
      [`codex:${thread}`],
    );
    status = "notLoaded";
    assert.deepEqual(await agents(), []);
    assert.deepEqual(await fs.readdir(list), []);
  },
);

test("pair start registers its agent, and a session command updates the entry after the CLI restarts", async (t) => {
  const { home, folder, agent, agents } = await scratch(t);
  const directory = await folder("app");
  const inbox = (name) => ({
    CLAUDE_CODE_SESSION_ID: "resumed",
    CLAUDE_CODE_MESSAGING_SOCKET: path.join(home, `${name}.sock`),
    CLAUDE_CODE_MESSAGING_TOKEN: name,
  });
  const first = await agent(directory, { env: inbox("first") });
  const started = await first.run(["start", "--title", "Test", "--json"]);
  assert.equal(started.status, 0, started.stderr);
  assert.equal(started.stderr, "");
  const { sessionDir } = JSON.parse(started.stdout);
  const [registered] = await agents();
  assert.equal(registered.pid, first.pid);

  // claude --resume keeps the session ID and starts a new process with a new
  // inbox socket.
  await first.kill();
  const resumed = await agent(directory, { env: inbox("second") });
  const status = await resumed.run(["status", "--session-dir", sessionDir]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stderr, "");
  const [updated] = await agents();
  assert.deepEqual(
    [updated.id, updated.name, updated.pid],
    [registered.id, registered.name, resumed.pid],
  );

  // A session command leaves an agent that never registered unregistered.
  const other = await agent(directory, {
    env: { ...inbox("other"), CLAUDE_CODE_SESSION_ID: "other" },
  });
  assert.equal(
    (await other.run(["status", "--session-dir", sessionDir])).status,
    0,
  );
  assert.deepEqual(
    (await agents()).map((entry) => entry.id),
    ["claude-code:resumed"],
  );
});

test("pair start still starts the session when it cannot register its agent", async (t) => {
  const { folder, agent, agents } = await scratch(t);
  const a = await agent(await folder("app"));
  const started = await a.run(["start", "--title", "Test", "--json"]);
  assert.equal(started.status, 0, started.stderr);
  assert.ok(JSON.parse(started.stdout).sessionDir);
  assert.equal(
    started.stderr,
    "pair: This agent is not registered, so pair agents does not list it. Claude Code set no session ID for this command, so pair has no ID to list the session under.\n",
  );
  assert.deepEqual(await agents(), []);
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
