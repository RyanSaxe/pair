import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { settings, version } from "../../src/shared/settings.mjs";
import {
  alive,
  exec,
  killHub,
  literal,
  pairCli,
  root,
} from "../support/hub.mjs";

// Git passes GIT_DIR to hooks and to the commands git rebase -x runs, and
// GIT_DIR would point every git command in this test at pair's own repository.
const withoutGit = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const git = (cwd, ...args) =>
  exec(
    "git",
    [
      "-c",
      "user.name=pair",
      "-c",
      "user.email=pair@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, env: withoutGit },
  );

// copyPair copies the files npm packs into directory, so that a test can run
// pair from a folder other than this checkout, and returns its cli.mjs.
async function copyPair(directory) {
  const { files } = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  for (const entry of ["package.json", ...files])
    await fs.cp(path.join(root, entry), path.join(directory, entry), {
      recursive: true,
    });
  return path.join(directory, "src/cli.mjs");
}

// clonePair makes directory a git clone with every file of a copy of pair
// committed.
async function clonePair(directory) {
  await fs.mkdir(directory);
  await git(directory, "init", "--quiet");
  // The test writes nothing until git confirms that the repository it created
  // is the new directory and not a repository around it.
  const { stdout } = await git(directory, "rev-parse", "--show-toplevel");
  assert.equal(await fs.realpath(stdout.trim()), await fs.realpath(directory));
  const cli = await copyPair(directory);
  await git(directory, "add", "--all");
  await git(directory, "commit", "--quiet", "--no-verify", "-m", "pair");
  return cli;
}

// scratch returns a temporary home with the state directory every hub in the
// test shares, and kills the hub and removes the home when the test ends.
async function scratch(t) {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pair-replace-")),
  );
  const env = { XDG_STATE_HOME: path.join(home, "state"), PAIR_HUB_PORT: "0" };
  const agent = async (name, cli) => {
    await fs.mkdir(path.join(home, name));
    return pairCli(path.join(home, name), env, cli ? { cli } : {});
  };
  const record = async (config) =>
    JSON.parse(await fs.readFile(config.hubFile, "utf8"));
  t.after(async () => {
    await killHub(settings(env));
    await fs.rm(home, { recursive: true, force: true });
  });
  return { home, agent, record };
}

const edit = (folder) =>
  fs.appendFile(path.join(folder, "src/build/lint.mjs"), "\n// new code\n");

// The steps share one git clone, because git on Windows is slow enough that
// a clone for each step slows the tests running beside this file.
test("commands from the hub's folder replace a hub with live sessions only on committed code, and one command at a time does it", async (t) => {
  const { home, agent, record } = await scratch(t);
  const clone = path.join(home, "clone");
  const a = await agent("a", await clonePair(clone));
  const { sessionDir } = await a.start();
  const commit = (message) =>
    git(clone, "commit", "--quiet", "--no-verify", "-am", message);
  const hubAnswer = async () =>
    (
      await fetch(`http://127.0.0.1:${(await record(a.config)).port}/api/hub`)
    ).json();

  // Agents run pair start rarely, so a status command replaces the hub too,
  // after its own request.
  const first = await record(a.config);
  await edit(clone);
  await commit("New code");
  const status = await a.output("status", "--session-dir", sessionDir);
  assert.equal(status.stderr, "");
  const second = await record(a.config);
  assert.notEqual(second.version, first.version);
  assert.equal(alive(first.pid), false);
  assert.equal((await hubAnswer()).live, 1);

  await edit(clone);
  const kept = await a.output("status", "--session-dir", sessionDir);
  const [, edited] = kept.stderr.match(
    new RegExp(
      `^pair: The hub runs code version ${second.version} from ${literal(clone)}, and the code there is now version ([0-9a-f]{12}), with uncommitted changes under src/ or adapters/\\. While a session is live on the hub, pair replaces the hub only with committed code, so the hub stays on version ${second.version}\\. The next pair command that reaches the hub replaces it with one on the new code once those changes are committed or no session is live\\.\\n$`,
    ),
  );
  assert.notEqual(edited, second.version);
  assert.equal((await record(a.config)).pid, second.pid);

  await commit("Newer code");
  const started = await Promise.all(
    [1, 2, 3].map(() => a.output("start", "--title", "Test", "--json")),
  );
  const third = await record(a.config);
  assert.equal(third.version, edited);
  assert.equal(alive(second.pid), false);
  for (const { stdout, stderr } of started) {
    assert.equal(stderr, "");
    assert.equal(new URL(JSON.parse(stdout).url).port, String(third.port));
  }
  const log = await fs.readFile(a.config.hubLog, "utf8");
  assert.equal(log.match(/ listening on /g).length, 3);
  assert.equal((await hubAnswer()).live, 4);

  // With no live session, a command replaces the hub on uncommitted code.
  await edit(clone);
  const sessions = [
    sessionDir,
    ...started.map(({ stdout }) => JSON.parse(stdout).sessionDir),
  ];
  for (const directory of sessions)
    await a.run("pause", "--session-dir", directory, "--reason", "idle");
  const fourth = await record(a.config);
  assert.notEqual(fourth.version, third.version);
  assert.equal(alive(third.pid), false);
});

// The start that stops the old hub must not mistake the stopping hub for one
// that hangs.
test("a command from another folder replaces a hub that runs other code only when no session is live on it", async (t) => {
  const { home, agent, record } = await scratch(t);
  const copy = path.join(home, "copy");
  const other = await agent("other", await copyPair(copy));
  await edit(copy);
  const current = await agent("current");
  const first = await other.start();
  const before = await record(other.config);
  assert.notEqual(before.version, version);
  const { stdout, stderr } = await current.output(
    "start",
    "--title",
    "Test",
    "--json",
  );
  assert.equal(
    stderr,
    `pair: The hub runs code version ${before.version} from ${copy}, and this command runs code version ${version} from ${await fs.realpath(root)}. While a session is live on the hub, pair replaces the hub only with code from the hub's own folder, so the hub stays on version ${before.version}. The next pair command that reaches the hub while no session is live replaces the hub with one on its own code.\n`,
  );
  assert.equal((await record(other.config)).pid, before.pid);
  await other.run("pause", "--session-dir", first.sessionDir, "--reason", "x");
  const { sessionDir } = JSON.parse(stdout);
  await current.run("pause", "--session-dir", sessionDir, "--reason", "x");
  await current.start();
  const after = await record(current.config);
  assert.notEqual(after.pid, before.pid);
  assert.equal(after.version, version);
  assert.equal(alive(before.pid), false);
});
