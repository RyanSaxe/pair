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
  const reviewer = (id, action) =>
    a.request(`${a.base}/api/side-work/${id}/${action}`, {});
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
      `pair: side work "Delete visual-review" was started in parallel on session ${a.directory}. Do it apart from the session's own work: in a separate git worktree, on its own branch from the session's branch, done by you or by an agent you brief with the context it needs, ending in a pull request into the session's branch. Report each change with pair side-work update 1, then go back to what you were doing.`,
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
  assert.equal((await update("1", { state: "pr", url })).code, 200);
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

test("a failed wake returns the item to Recorded, and a new hub keeps it", async (t) => {
  const { h, a, add, reviewer, items } = await sideWorkSession(t);
  await add();
  await a.inbox.close();
  assert.equal((await reviewer("1", "start")).code, 200);
  assert.equal(await waitUntil(async () => (await items())[0].wake), true);
  const [failed] = await items();
  assert.equal(failed.state, "recorded");
  assert.equal(failed.wake.ok, false);
  // The next hub reads the item back from the session directory.
  await h.server.close();
  const next = await startHub(h.config);
  t.after(next.close);
  const status = await fetch(`${next.origin}${a.base}/api/status`);
  assert.deepEqual((await status.json()).sideWork, [failed]);
});
