import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { agentsScratch, outsideAgents } from "../support/agents.mjs";
import { exec } from "../support/hub.mjs";

// The stand-in's home is the test's directory, so pair prints the test's
// folders under ~.
const shown = (name) => path.join("~", name);
const ids = (entries) => entries.map((entry) => entry.id);
const failed = ({ status, stderr }) => status === 1 && stderr.length > 0;

test("pair register names a session for its folder, and gives it the same name after its CLI restarts", async (t) => {
  const { list, folder, agent, agents } = await agentsScratch(t);
  const directory = await folder("Fix Login");
  const git = (...args) =>
    exec("git", args, { cwd: directory, env: outsideAgents });
  await git("init", "--quiet", "-b", "fix-login");
  const { stdout: top } = await git("rev-parse", "--show-toplevel");
  assert.equal(await fs.realpath(top.trim()), await fs.realpath(directory));
  const env = {
    CLAUDE_CODE_SESSION_ID: "6f1c2a9e-0d1b-4c8e-9a51-2f6b7d1e9c30",
  };
  const first = await agent(directory, { env });

  const registered = await first.run(["register"]);
  assert.equal(registered.status, 0, registered.stderr);
  const [, row] = (await first.run(["agents"])).stdout.split("\n");
  assert.deepEqual(row.split(/ {2,}/), [
    /^Registered (fix-login-[0-9a-f]{2}),/.exec(registered.stdout)[1],
    "Claude Code",
    shown("Fix Login"),
    "fix-login",
    "claude-code:6f1c2a9e",
  ]);
  // The entry has Claude Code's inbox token, so only the user can read it.
  // Windows has no file modes.
  if (process.platform !== "win32") {
    const [file] = await fs.readdir(list);
    assert.equal((await fs.stat(list)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(list, file))).mode & 0o777, 0o600);
  }

  // claude --resume keeps the session ID and starts a new process, and pair
  // agents deletes the entry of the process that exited.
  await first.kill();
  assert.deepEqual(await agents(), []);
  const resumed = await agent(directory, { env });
  assert.equal((await resumed.run(["register"])).stdout, registered.stdout);
});

test("a session whose name a running session has gets the next one, and --name refuses a taken name", async (t) => {
  const { folder, agent } = await agentsScratch(t);
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
  assert.ok(failed(await second.run(["register", "--name", "shop-72"])));
  assert.equal(await named(second, "--name", "till"), "till");
  assert.equal(await named(second), "till");
});

test("pair agents deletes the entry of a CLI that exited and of a process ID that a new process has", async (t) => {
  const { list, folder, agent, agents } = await agentsScratch(t);
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
  const [entry] = await agents();
  await fs.writeFile(
    path.join(list, "reused.json"),
    JSON.stringify({
      ...entry,
      id: "claude-code:reused",
      pid: process.pid,
      processStart: "Thu Jan 1 00:00:00 1970",
    }),
  );
  await exits.kill();
  assert.deepEqual(ids(await agents()), ["claude-code:stays"]);
  assert.equal((await fs.readdir(list)).length, 1);
});

// Codex's sandbox refuses to run ps, and a PATH without ps or PowerShell
// stands in for it on every system. An entry from a CLI that this pair has
// no adapter for may come from a newer pair.
test("pair agents refuses and deletes nothing when it cannot read the processes, and keeps an entry it cannot check", async (t) => {
  const { list, folder, agent, agents } = await agentsScratch(t);
  const claude = await agent(await folder("api"), {
    env: { CLAUDE_CODE_SESSION_ID: "kept" },
  });
  assert.equal((await claude.run(["register"])).status, 0);
  const [kept] = await agents();
  await fs.writeFile(
    path.join(list, "gemini.json"),
    JSON.stringify({ ...kept, id: "gemini:s-1", cli: "gemini" }),
  );
  const blind = await claude.run(["agents"], {
    env: { PATH: await folder("no-tools") },
  });
  assert.ok(failed(blind));
  assert.deepEqual(ids(await agents()), ["claude-code:kept"]);
  assert.equal((await fs.readdir(list)).length, 2);
});

test("a new session in the same process replaces the entry of the session before it, as after /clear", async (t) => {
  const { folder, agent, agents } = await agentsScratch(t);
  const claude = await agent(await folder("app"), {
    env: { CLAUDE_CODE_SESSION_ID: "before" },
  });
  assert.equal((await claude.run(["register"])).status, 0);
  const cleared = await claude.run(["register"], {
    env: { CLAUDE_CODE_SESSION_ID: "after" },
  });
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.deepEqual(ids(await agents()), ["claude-code:after"]);
});

test("pair register --hook reads Codex's thread ID from stdin, and exits 0 when it cannot register", async (t) => {
  const { folder, agent, agents } = await agentsScratch(t);
  const directory = await folder("api");
  const codex = await agent(directory, { harness: "codex" });
  const hook = await codex.run(["register", "--hook"], {
    input: JSON.stringify({
      session_id: "0199c1d4-1111-7000-8000-000000000000",
      hook_event_name: "SessionStart",
    }),
  });
  assert.equal(hook.status, 0, hook.stderr);
  assert.match(hook.stdout, /^Registered api-[0-9a-f]{2}, codex:0199c1d4,/);
  const unregistered = await codex.run(["register", "--hook"]);
  assert.equal(unregistered.status, 0);
  assert.ok(unregistered.stderr);
  assert.ok(failed(await codex.run(["register"])));

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

test("pair start registers its agent, and starts the session when it cannot register it", async (t) => {
  const { folder, agent, agents } = await agentsScratch(t);
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
  assert.ok(second.stderr);
  assert.equal((await agents()).length, 1);
});
