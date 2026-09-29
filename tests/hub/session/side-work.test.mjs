import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startHub } from "../../../src/hub/server.mjs";
import { hub, sleep, waitUntil } from "../../support/hub.mjs";

const item = {
  title: "Delete visual-review",
  text: "The skill is deprecated but still installed.",
  source: "From the conversation",
};
async function sideWorkSession(t) {
  const h = await hub(t);
  const a = await h.session();
  const add = async (fields = item) => {
    const added = await a.action("side-work", { change: "add", ...fields });
    assert.equal(added.code, 200, added.body.error);
    return added.body.item;
  };
  const update = (id, fields, agent = a.agent) =>
    a.action("side-work", { change: "update", id, ...fields, agent });
  const reviewer = (id, action, body = {}) =>
    a.request(`${a.base}/api/side-work/${id}/${action}`, body);
  const items = async () => (await a.status()).body.sideWork;
  return { h, a, add, update, reviewer, items };
}

test("side work moves from Recorded to Done, and Start in parallel wakes the holder once", async (t) => {
  const { h, a, add, update, reviewer, items } = await sideWorkSession(t);
  const added = await add();
  assert.equal(added.id, "1");
  assert.equal(added.state, "recorded");
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(a.directory, "side-work", "1.json"), "utf8"),
    ),
    added,
  );
  assert.deepEqual(await items(), [added]);
  // Only the reviewer starts an item.
  const early = await update("1", { state: "working" });
  assert.equal(early.code, 409);
  assert.match(early.body.error, /Start in parallel/);

  const started = await reviewer("1", "start");
  assert.equal(started.code, 200, started.body.error);
  assert.equal(started.body.sideWork[0].state, "started");
  assert.equal(await waitUntil(async () => (await items())[0].wake), true);
  assert.equal((await items())[0].wake.ok, true);
  assert.deepEqual(
    a.inbox.wakes.map((wake) => wake.message.message.content),
    [
      `pair: side work "Delete visual-review" was started in parallel on session ${a.directory}. Do it apart from the session's own work: in a separate git worktree, on its own branch from the session's branch, done by you or by an agent you brief with the context it needs, ending in a pull request into the session's branch. When the session has no branch of its own in the repository you change, branch from that repository's default branch and open the pull request into it. Report each change with pair side-work update 1, then go back to what you were doing.`,
    ],
  );
  const again = await reviewer("1", "start");
  assert.equal(again.code, 409);
  await sleep(50);
  assert.equal(a.inbox.wakes.length, 1);

  // An item moves one state at a time and only forward, so it is done only
  // after it has a pull request.
  const skipped = await update("1", { state: "done" });
  assert.equal(skipped.code, 409);
  assert.equal(
    skipped.body.error,
    "Side work 1 is in state started, so the next update is --state working.",
  );
  // An agent the holder briefed reports too.
  const briefed = (await h.inbox()).agent;
  assert.equal((await update("1", { state: "working" }, briefed)).code, 200);
  assert.equal((await update("1", { state: "done" })).code, 409);
  const unlinked = await update("1", { state: "pr" });
  assert.equal(unlinked.code, 400);
  const url = "https://github.com/RyanSaxe/pair/pull/12";
  const opened = await update("1", { state: "pr", url });
  assert.equal(opened.code, 200);
  assert.equal(
    opened.body.next,
    `Run pair side-work update 1 --state done --session-dir ${a.directory} after the pull request is merged.`,
  );
  const back = await update("1", { state: "working" });
  assert.equal(back.code, 409);
  assert.equal(
    back.body.error,
    "Side work 1 is in state pr, so the next update is --state done.",
  );
  assert.equal((await update("1", { state: "done" })).code, 200);
  assert.deepEqual(
    (await items()).map(({ state, url }) => ({ state, url })),
    [{ state: "done", url }],
  );
  assert.equal((await update("1", { state: "working" })).code, 409);
});

test("the reviewer drops side work at any state, and the agent is told to stop", async (t) => {
  const { add, update, reviewer, items } = await sideWorkSession(t);
  await add();
  await add({ ...item, title: "Say why ack fails on an older hub" });
  assert.equal((await reviewer("1", "start")).code, 200);
  assert.equal(await waitUntil(async () => (await items())[0].wake), true);
  assert.equal((await update("1", { state: "working" })).code, 200);
  for (const id of ["1", "2"]) {
    const dropped = await reviewer(id, "drop");
    assert.equal(dropped.code, 200, dropped.body.error);
  }
  assert.deepEqual(
    (await items()).map((entry) => entry.state),
    ["dropped", "dropped"],
  );
  assert.equal((await reviewer("1", "drop")).code, 200);
  assert.equal((await reviewer("2", "start")).code, 409);
  const late = await update("1", { state: "pr", url: "https://example.com/1" });
  assert.equal(late.code, 409);
  assert.equal(
    late.body.error,
    "The reviewer dropped side work 1. Stop working on it.",
  );
});

test("a start message stays on the item and ends the wake line", async (t) => {
  const { a, add, reviewer, items } = await sideWorkSession(t);
  await add();
  await add({ ...item, title: "Leave the guide alone" });
  const message = "Only the README.\nLeave the guide alone.";
  const started = await reviewer("1", "start", {
    message: `  ${message}  `,
  });
  assert.equal(started.code, 200, started.body.error);
  assert.equal(started.body.sideWork[0].message, message);
  assert.equal(await waitUntil(async () => (await items())[0].wake), true);
  assert.equal((await items())[0].message, message);
  assert.equal(
    a.inbox.wakes[0].message.message.content.endsWith(
      `\n\nThe reviewer's message. Where it differs from the item's text, follow it, and give it word for word to any agent you brief:\n${message}`,
    ),
    true,
  );

  for (const body of [{ message: "x".repeat(4001) }, { message: 3 }]) {
    const refused = await reviewer("2", "start", body);
    assert.equal(refused.code, 400);
    assert.equal((await items())[1].state, "recorded");
  }
});

test("a recorded side-work item can move to a new session", async (t) => {
  const { h, a, add, update, reviewer, items } = await sideWorkSession(t);
  const added = await add();
  const briefed = (await h.inbox()).agent;
  const url = "http://127.0.0.1:4886/s/new-session/";
  assert.equal((await a.status()).body.sessionDir, a.directory);

  const moved = await update(added.id, { state: "moved", url }, briefed);
  assert.equal(moved.code, 200, moved.body.error);
  assert.equal(moved.body.item.state, "moved");
  assert.equal(moved.body.item.url, url);
  const corrected = await update(added.id, {
    state: "moved",
    url: `${url}again`,
  });
  assert.equal(corrected.code, 200, corrected.body.error);
  assert.equal(corrected.body.item.url, `${url}again`);

  const missing = await add();
  const noUrl = await update(missing.id, { state: "moved" });
  assert.equal(noUrl.code, 400);
  assert.equal(
    noUrl.body.error,
    "--state moved takes --url with the new session's URL, which pair start prints",
  );
  const invalid = await update(missing.id, {
    state: "moved",
    url: "file:///tmp/session",
  });
  assert.equal(invalid.code, 400);
  assert.equal(invalid.body.error, "--url takes an http or https link");

  const waitForWake = async (id) =>
    assert.equal(
      await waitUntil(
        async () => (await items()).find((entry) => entry.id === id)?.wake,
      ),
      true,
    );
  const start = async () => {
    const next = await add();
    assert.equal((await reviewer(next.id, "start")).code, 200);
    await waitForWake(next.id);
    return next;
  };
  const started = await start();
  const startedMove = await update(started.id, { state: "moved", url });
  assert.equal(startedMove.code, 409);
  assert.equal(
    startedMove.body.error,
    `Side work ${started.id} was started in parallel, so it cannot move to a new session.`,
  );

  const working = await start();
  assert.equal((await update(working.id, { state: "working" })).code, 200);
  const workingMove = await update(working.id, { state: "moved", url });
  assert.equal(workingMove.code, 409);
  assert.equal(
    workingMove.body.error,
    `Side work ${working.id} was started in parallel, so it cannot move to a new session.`,
  );

  const pullRequest = await start();
  assert.equal((await update(pullRequest.id, { state: "working" })).code, 200);
  assert.equal(
    (
      await update(pullRequest.id, {
        state: "pr",
        url: "https://github.com/RyanSaxe/pair/pull/12",
      })
    ).code,
    200,
  );
  const pullRequestMove = await update(pullRequest.id, {
    state: "moved",
    url,
  });
  assert.equal(pullRequestMove.code, 409);
  assert.equal(
    pullRequestMove.body.error,
    `Side work ${pullRequest.id} was started in parallel, so it cannot move to a new session.`,
  );

  const dropped = await add();
  assert.equal((await reviewer(dropped.id, "drop")).code, 200);
  const droppedMove = await update(dropped.id, { state: "moved", url });
  assert.equal(droppedMove.code, 409);
  assert.equal(
    droppedMove.body.error,
    `The reviewer dropped side work ${dropped.id}. Stop working on it.`,
  );

  for (const state of ["working", "pr", "done"]) {
    const refused = await update(added.id, { state });
    assert.equal(refused.code, 409);
    assert.equal(
      refused.body.error,
      `Side work ${added.id} moved to a new session, so it takes no other state.`,
    );
  }
  const restart = await reviewer(added.id, "start");
  assert.equal(restart.code, 409);
  assert.equal(
    restart.body.error,
    `Side work ${added.id} moved to a new session`,
  );
  const unsupported = await update(added.id, { state: "gone" });
  assert.equal(unsupported.code, 400);
  assert.equal(
    unsupported.body.error,
    "pair side-work update takes --state working, pr, done or moved",
  );
});

test("a failed wake returns the item to Recorded, and a new hub keeps it", async (t) => {
  const { h, a, add, reviewer, items } = await sideWorkSession(t);
  await add();
  await a.inbox.close();
  const message = "Keep this with the retry.";
  assert.equal((await reviewer("1", "start", { message })).code, 200);
  assert.equal(await waitUntil(async () => (await items())[0].wake), true);
  const [failed] = await items();
  assert.equal(failed.state, "recorded");
  assert.equal(failed.message, message);
  assert.equal(failed.wake.ok, false);
  // The next hub reads the item back from the session directory.
  await h.server.close();
  const next = await startHub(h.config);
  let closed = false;
  const closeNext = async () => {
    if (!closed) await next.close();
    closed = true;
  };
  t.after(closeNext);
  const sideWork = async () =>
    (await (await fetch(`${next.origin}${a.base}/api/status`)).json()).sideWork;
  assert.deepEqual(await sideWork(), [failed]);
  const retry = await fetch(`${next.origin}${a.base}/api/side-work/1/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: next.origin },
    body: "{}",
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).sideWork[0].message, undefined);
  // The retry's wake fails after the response and writes the item again.
  // A write that lands while hub(t)'s cleanup removes the session directory
  // fails that cleanup, and this hub's timer then keeps the file running,
  // so the test waits for the write before it closes the hub.
  assert.equal(await waitUntil(async () => (await sideWork())[0].wake), true);
  await closeNext();
});
