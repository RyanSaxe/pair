import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../../src/cli/build.mjs";
import { bellLines } from "../../../src/frame/sync/center.mjs";
import {
  announced,
  eventTitle,
  wakeAlert,
} from "../../../src/frame/sync/notifications.mjs";
import { countUnopened } from "../../../src/frame/sync/opened.mjs";
import { startHub } from "../../../src/hub/server.mjs";
import { readPlanData } from "../../../src/shared/records.mjs";
import {
  exec,
  hub,
  planData,
  sessionConfig,
  sleep,
  waitUntil,
} from "../../support/hub.mjs";

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
  assert.equal(typeof status.body.status.closedAt, "string");
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
    assert.equal(status.closedAt, null);
    const { sessions } = (await a.request("/api/sessions")).body;
    assert.deepEqual(
      sessions.map(({ id }) => id),
      [a.id],
    );
    const taken = await step(a);
    assert.equal(taken.code, 200, taken.body.error);
  });

// Every round has a time between its Agreed and its first page, and the
// reviewer can close the session then. The closed page carries Reopen.
test("a round with no published page opens read-only with its Agreed, at its round's address and after a close", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish({ ...planData(), stopAfter: 0 })).code, 200);
  const agreedOnly = ({ code, body }) => {
    assert.equal(code, 200, body.error);
    const data = readPlanData(body);
    assert.equal(data.round, "1");
    assert.equal(data.task.title, "The task");
    assert.deepEqual(data.pages, []);
    return sessionConfig(body);
  };
  assert.equal(agreedOnly(await a.request(`${a.base}/r/1`)).readonly, true);
  assert.equal((await close(a)).code, 200);
  assert.equal(agreedOnly(await a.request(`${a.base}/`)).closed, true);
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
  assert.equal(typeof (await a.status()).body.closedAt, "string");
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

// What any browser shows for a session, computed by the frame's own rules from
// the session list alone, so the answer holds for a device with no local copy of
// the seen lists. A system notification reads the listed events and not the
// cleared list, so alerts applies the frame's rule for those events.
async function shown(origin, a) {
  const { sessions, seen } = await (
    await fetch(`${origin}/api/sessions`)
  ).json();
  const entry = sessions.find(({ id }) => id === a.id);
  return {
    entry,
    bell: bellLines(sessions, new Set(seen.cleared), null).map(eventTitle),
    alerts: [
      wakeAlert(entry)?.title,
      ...entry.events
        .filter((event) => announced(entry, event))
        .map(eventTitle),
    ].filter(Boolean),
    unopened: countUnopened(entry, new Set(seen.opened)),
    seenCards: seen.cards,
  };
}
const reopen = (h, a) =>
  h.register(a.directory, a.inbox.target, { start: true, reopen: true });
const startedLists = { cleared: [], opened: [], cards: [] };
const proposal = (id) => ({
  id,
  title: `Card ${id}`,
  delivers: "The work.",
  recommend: "here",
});
async function openThread(a) {
  const id = crypto.randomUUID();
  const started = await a.request(`${a.base}/api/threads`, {
    id,
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "Why?",
  });
  assert.equal(started.code, 201, started.body.error);
  return id;
}

test("reopening shows nothing from before the close as new on any device, also after a new hub loads it", async (t) => {
  const h = await hub(t);
  const a = await h.session({ start: true });
  const origin = h.server.origin;
  assert.equal((await a.publish(planData())).code, 200);
  assert.equal((await a.action("propose", proposal("old"))).code, 200);
  const replied = await a.action("reply", {
    note: await openThread(a),
    text: "Because.",
  });
  assert.equal(replied.code, 200, replied.body.error);
  // A browser started the lists, and the reviewer cleared one line.
  const { entry: before } = await shown(origin, a);
  assert.equal(before.events.length, 4);
  await a.request("/api/seen", {
    ...startedLists,
    cleared: [before.events[0].id],
  });

  assert.equal((await close(a)).code, 200);
  assert.equal((await reopen(h, a)).code, 200);
  const quiet = await shown(origin, a);
  assert.deepEqual(quiet.bell, []);
  assert.deepEqual(quiet.alerts, []);
  assert.equal(quiet.unopened, 0);
  assert.deepEqual(quiet.seenCards, [`${a.id}/old`]);
  // The round still waits, so the session list can still mark it Waiting.
  assert.equal(quiet.entry.needsYou, true);

  await h.server.close();
  const next = await startHub(h.config);
  t.after(next.close);
  const afterRestart = await shown(next.origin, a);
  assert.deepEqual(afterRestart.bell, []);
  assert.equal(afterRestart.unopened, 0);
});

test("after a reopen, a reply, a proposal and the next round each notify", async (t) => {
  const h = await hub(t);
  const a = await h.session({ start: true });
  const origin = h.server.origin;
  assert.equal((await a.publish(planData())).code, 200);
  const thread = await openThread(a);
  await a.request("/api/seen", startedLists);
  assert.equal((await close(a)).code, 200);
  assert.equal((await reopen(h, a)).code, 200);

  assert.equal(
    (await a.action("reply", { note: thread, text: "Because." })).code,
    200,
  );
  assert.equal((await a.action("propose", proposal("later"))).code, 200);
  const lines = ["Agent proposed Card later", "Agent replied on Overview"];
  const said = await shown(origin, a);
  assert.deepEqual([...said.bell].sort(), lines);
  assert.deepEqual([...said.alerts].sort(), lines);
  assert.deepEqual(said.seenCards, []);

  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal((await a.action("read")).code, 200);
  assert.equal((await a.publish(planData("2"))).code, 200);
  const published = await shown(origin, a);
  assert.ok(published.bell.includes("Round 2 is waiting for you"));
  assert.ok(published.alerts.includes("Round 2 is waiting for you"));
  assert.equal(published.unopened, 2);
});

test("after a reopen, only a page published after it counts as new, and the finished round notifies", async (t) => {
  const h = await hub(t);
  const a = await h.session({ start: true });
  const origin = h.server.origin;
  assert.equal((await a.publish(unfinished)).code, 200);
  await a.request("/api/seen", startedLists);
  assert.equal((await close(a)).code, 200);
  assert.equal((await reopen(h, a)).code, 200);
  assert.equal((await shown(origin, a)).unopened, 0);

  const { step } = beforeClose.find(({ name }) =>
    name.includes("not published"),
  );
  assert.equal((await step(a)).code, 200);
  const finished = await shown(origin, a);
  assert.equal(finished.unopened, 1);
  assert.deepEqual(finished.bell, ["Round 1 is waiting for you"]);
});

// The first browser to send a list counts everything the hub lists as seen, and
// it does that only while the hub's list is null.
test("a reopen before any browser started the lists leaves them for the first browser", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  assert.equal((await close(a)).code, 200);
  assert.equal((await reopen(h, a)).code, 200);
  assert.deepEqual((await a.request("/api/sessions")).body.seen, {
    cleared: null,
    opened: null,
    cards: null,
  });
});
