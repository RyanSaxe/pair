import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  exec,
  exists,
  hub,
  planData,
  sleep,
  waitUntil,
} from "../../support/hub.mjs";

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

test("closing a session removes only the git worktrees inside its directory", async (t) => {
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
  const inside = path.join(a.directory, "scratch", "try");
  const outside = path.join(temp, "outside");
  const linked = path.join(temp, "linked");
  await git(checkout, "worktree", "add", "--quiet", "-b", "try", inside);
  await git(checkout, "worktree", "add", "--quiet", "-b", "outside", outside);
  await git(checkout, "worktree", "add", "--quiet", "--detach", linked);
  // A path inside the session's directory that leads to a worktree outside.
  const link = path.join(a.directory, "linked");
  await fs.symlink(
    linked,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  // The scratch worktree has changes the agent never committed.
  await fs.writeFile(path.join(inside, "file.txt"), "tried\n");
  await fs.writeFile(path.join(inside, "tried.txt"), "new\n");

  const repository = async () => ({
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
  });
  const before = await repository();
  assert.equal((await a.request(`${a.base}/api/dismiss`, {})).code, 200);
  assert.equal(await exists(inside), false);
  assert.deepEqual(await repository(), before);
  const worktrees = (await git(checkout, "worktree", "list", "--porcelain"))
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length)))
    .sort();
  assert.deepEqual(worktrees, [checkout, linked, outside].sort());
  for (const directory of [outside, linked])
    assert.equal(await exists(path.join(directory, "file.txt")), true);
  assert.equal(await fs.realpath(link), linked);
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
