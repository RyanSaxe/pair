import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../../src/cli/build.mjs";
import { exec, hub, planData, sleep, waitUntil } from "../../support/hub.mjs";

const closed = "The reviewer closed this session. Stop working on it.";
const close = (a) => a.request(`${a.base}/api/dismiss`, {});

// Git passes GIT_DIR to hooks and to the commands git rebase -x runs, and
// GIT_DIR would point every git command in this test at pair's own repository.
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

// The hub deletes no file when the reviewer closes a session. The agent removes
// the worktrees and directories it made in the session's directory once the
// reviewer agrees, and the hub leaves the user's repository as it was.
test("closing a session deletes nothing inside its directory or in the user's repository", async (t) => {
  const temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pair-close-")),
  );
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const checkout = path.join(temp, "checkout");
  await fs.mkdir(checkout);
  await git(checkout, "init", "--quiet");
  // The test writes nothing until git confirms that the repository it created
  // is the new directory and not a repository around it.
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
  await fs.writeFile(path.join(checkout, "file.txt"), "changed\n");
  await fs.writeFile(path.join(checkout, "untracked.txt"), "new\n");

  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const dirty = path.join(a.directory, "scratch", "dirty");
  const clean = path.join(a.directory, "scratch", "clean");
  // plain stands for the directory that a session outside a git repository
  // works in.
  const plain = path.join(a.directory, "scratch", "plain");
  const outside = path.join(temp, "outside");
  await git(checkout, "worktree", "add", "--quiet", "-b", "dirty", dirty);
  await git(checkout, "worktree", "add", "--quiet", "-b", "clean", clean);
  await git(checkout, "worktree", "add", "--quiet", "-b", "outside", outside);
  await fs.mkdir(plain);
  await fs.writeFile(path.join(plain, "notes.txt"), "notes\n");
  await fs.writeFile(path.join(dirty, "file.txt"), "tried\n");
  await fs.writeFile(path.join(dirty, "tried.txt"), "new\n");

  async function files(directory) {
    const found = {};
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) Object.assign(found, await files(file));
      else found[file] = await fs.readFile(file, "utf8");
    }
    return found;
  }
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

  assert.equal((await close(a)).code, 200);
  assert.deepEqual(await snapshot(), before);
});

test("after a close the agent's next command says the reviewer closed the session, and nothing wakes it", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  // The reviewer closes the session while feedback is still unread.
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal(await waitUntil(() => a.inbox.wakes.length === 1), true);
  assert.equal((await close(a)).code, 200);
  for (const action of ["read", "ack", "publish"]) {
    const refused = await a.action(action);
    assert.equal(refused.code, 409);
    assert.equal(refused.body.error, closed);
  }
  const status = await a.action("status");
  assert.equal(status.body.next, closed);
  assert.equal(status.body.status.stage, "complete");
  await sleep(50);
  assert.equal(a.inbox.wakes.length, 1);
});

// Each row brings a session to the point where the reviewer closes it, and then
// takes the step that the session's next line names, which the hub refuses
// unless the session is live at the right stage.
const unfinished = {
  ...planData(),
  pages: [
    ...planData().pages,
    { id: "notes", title: "Notes", html: "<p>Never published.</p>" },
  ],
  stopAfter: 1,
};
const beforeClose = [
  {
    name: "nothing published",
    setup: async () => {},
    stage: "ready",
    next: /^Publish Agreed/,
    step: (a) => a.publish(planData()),
  },
  {
    name: "a round waiting for feedback",
    setup: (a) => a.publish(planData()),
    stage: "updated",
    next: /^You published round 1/,
    step: (a) => a.feedback(a.event()),
  },
  {
    name: "feedback the agent has not read",
    setup: async (a) => {
      await a.publish(planData());
      await a.feedback(a.event());
    },
    stage: "submitted",
    next: /^Run pair read .* to see what the reviewer sent/,
    step: (a) => a.action("read"),
  },
  {
    name: "feedback the agent read",
    setup: async (a) => {
      await a.publish(planData());
      await a.feedback(a.event());
      await a.action("read");
    },
    stage: "working",
    next: /^Edit Agreed/,
    step: (a) => a.publish(planData("2")),
  },
  {
    name: "a round with a page not published",
    setup: (a) => a.publish(unfinished),
    stage: "working",
    next: /still have to publish these pages: notes\. None of them has started/,
    step: async (a) =>
      a.action("publish", {
        html: await buildPage(path.join(a.directory, "source.json"), {
          name: unfinished.name,
          round: unfinished.round,
          title: unfinished.title,
          page: unfinished.pages[1],
        }),
      }),
  },
];
for (const { name, setup, stage, next, step } of beforeClose)
  test(`pair start --reopen makes a session closed with ${name} live again`, async (t) => {
    const h = await hub(t);
    const a = await h.session();
    await setup(a);
    assert.equal((await close(a)).code, 200);
    const started = await h.register(a.directory, a.inbox.target, {
      start: true,
      reopen: true,
    });
    assert.equal(started.code, 200, started.body.error);
    assert.match(started.body.next, next);
    assert.equal(started.body.moment, "start-reopen");
    const { body: status } = await a.status();
    assert.equal(status.stage, stage);
    assert.ok(!status.dismissedAt);
    const { sessions } = (await a.request("/api/sessions")).body;
    assert.deepEqual(
      sessions.map(({ id }) => id),
      [a.id],
    );
    const taken = await step(a);
    assert.equal(taken.code, 200, taken.body.error);
  });

test("pair start without --reopen leaves a closed session closed", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  assert.equal((await close(a)).code, 200);
  const started = await h.register(a.directory, a.inbox.target, {
    start: true,
  });
  assert.equal(started.body.next, closed);
  assert.equal((await a.status()).body.stage, "complete");
  assert.equal((await a.action("read")).code, 409);
});

test("pair start --reopen on a live session is a plain pair start", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const before = (await a.status()).body;
  const started = await h.register(a.directory, a.inbox.target, {
    start: true,
    reopen: true,
  });
  assert.equal(started.code, 200, started.body.error);
  assert.equal(started.body.moment, undefined);
  assert.match(started.body.next, /^You published round 1/);
  assert.equal((await a.status()).body.stage, before.stage);
});

test("reopening resets started pages, so the time since the close is not quiet time", async (t) => {
  const h = await hub(t, {}, { quietMs: 0 });
  const a = await h.session();
  await a.publish(unfinished);
  assert.equal((await a.action("progress", { start: ["notes"] })).code, 200);
  assert.equal(
    (await a.action("ack", { page: "notes", note: "Writing" })).code,
    200,
  );
  assert.equal((await close(a)).code, 200);
  await sleep(5);
  const { body } = await h.register(a.directory, a.inbox.target, {
    start: true,
    reopen: true,
  });
  assert.doesNotMatch(body.next, /No update in/);
  const { pages } = (await a.status()).body.openRound;
  const { state, note, startedAt } = pages.find(({ id }) => id === "notes");
  assert.equal(state, "queued");
  assert.equal(note, undefined);
  assert.equal(startedAt, undefined);
});

// The reviewer can paste the command into the agent that an earlier takeover
// replaced, and the hub refuses a former holder's first pair start otherwise.
test("a former holder can reopen the session, and takes it back", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const other = await h.inbox();
  await h.register(a.directory, other.target, { start: true });
  assert.equal((await close(a)).code, 200);
  const started = await h.register(a.directory, a.inbox.target, {
    start: true,
    reopen: true,
  });
  assert.equal(started.code, 200, started.body.error);
  assert.equal(started.body.moment, "start-reopen");
  assert.equal((await a.action("ack")).code, 200);
});
