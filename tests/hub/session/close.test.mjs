import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exec, hub, planData, sleep, waitUntil } from "../../support/hub.mjs";

// Git hands GIT_DIR to hooks and to the commands git rebase -x runs, and it
// would point every command here at pair's own repository.
const withoutGit = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const git = async (cwd, ...args) =>
  (
    await exec(
      "git",
      ["-c", "user.name=pair", "-c", "user.email=pair@example.com", ...args],
      { cwd, env: withoutGit },
    )
  ).stdout;

// Closing a session deletes no file. Every worktree and plain directory the
// agent made inside the session's directory stays for the agent to remove
// when the reviewer agrees, and the user's repository stays as it was.
test("closing a session deletes nothing inside its directory or in the user's repository", async (t) => {
  const temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pair-close-")),
  );
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const checkout = path.join(temp, "checkout");
  await fs.mkdir(checkout);
  await git(checkout, "init", "--quiet");
  // Nothing is written until git shows that the repository it made is the
  // new directory and not a repository around it.
  assert.equal(
    await fs.realpath(
      (await git(checkout, "rev-parse", "--show-toplevel")).trim(),
    ),
    checkout,
  );
  await fs.writeFile(path.join(checkout, "file.txt"), "one\n");
  await git(checkout, "add", "file.txt");
  await git(checkout, "commit", "--quiet", "--no-verify", "-m", "One");
  await git(checkout, "branch", "kept");
  // The user's checkout has changes of its own.
  await fs.writeFile(path.join(checkout, "file.txt"), "changed\n");
  await fs.writeFile(path.join(checkout, "untracked.txt"), "new\n");

  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const dirty = path.join(a.directory, "scratch", "dirty");
  const clean = path.join(a.directory, "scratch", "clean");
  // A plain directory, as a session outside a git repository uses.
  const plain = path.join(a.directory, "scratch", "plain");
  const outside = path.join(temp, "outside");
  await git(checkout, "worktree", "add", "--quiet", "-b", "dirty", dirty);
  await git(checkout, "worktree", "add", "--quiet", "-b", "clean", clean);
  await git(checkout, "worktree", "add", "--quiet", "-b", "outside", outside);
  await fs.mkdir(plain);
  await fs.writeFile(path.join(plain, "notes.txt"), "notes\n");
  // The dirty worktree has changes the agent never committed.
  await fs.writeFile(path.join(dirty, "file.txt"), "tried\n");
  await fs.writeFile(path.join(dirty, "tried.txt"), "new\n");

  // Each file under a directory with its contents.
  async function files(directory) {
    const found = {};
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) Object.assign(found, await files(file));
      else found[file] = await fs.readFile(file, "utf8");
    }
    return found;
  }
  // The checkout's branches, HEAD, status and worktrees, and every file in
  // the session's scratch directory and the outside worktree.
  const snapshot = async () => ({
    branches: await git(
      checkout,
      "for-each-ref",
      "--format=%(refname) %(objectname)",
    ),
    head:
      (await git(checkout, "symbolic-ref", "HEAD")) +
      (await git(checkout, "rev-parse", "HEAD")),
    status: await git(
      checkout,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ),
    worktrees: await git(checkout, "worktree", "list", "--porcelain"),
    scratch: await files(path.join(a.directory, "scratch")),
    outside: await files(outside),
  });
  const before = await snapshot();
  assert.match(before.worktrees, /^worktree .*\/scratch\/dirty$/m);
  assert.match(before.worktrees, /^worktree .*\/scratch\/clean$/m);
  assert.equal(before.scratch[path.join(plain, "notes.txt")], "notes\n");
  assert.equal(before.scratch[path.join(dirty, "tried.txt")], "new\n");

  assert.equal((await a.request(`${a.base}/api/dismiss`, {})).code, 200);
  assert.deepEqual(await snapshot(), before);
});

test("after a close the agent's next command says the session is complete, and nothing wakes it", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  // Feedback the agent has not read when the reviewer closes the session.
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal(await waitUntil(() => a.inbox.wakes.length === 1), true);
  assert.equal((await a.request(`${a.base}/api/dismiss`, {})).code, 200);
  for (const action of ["read", "ack", "publish"]) {
    const refused = await a.action(action);
    assert.equal(refused.code, 409);
    assert.equal(refused.body.error, "The session is complete.");
  }
  const status = await a.action("status");
  assert.equal(status.body.next, "The session is complete.");
  assert.equal(status.body.status.stage, "complete");
  await sleep(50);
  assert.equal(a.inbox.wakes.length, 1);
});
