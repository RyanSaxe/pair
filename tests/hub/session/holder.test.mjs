import assert from "node:assert/strict";
import test from "node:test";
import { hub, planData, sleep, waitUntil } from "../../support/hub.mjs";

test("start hands the session to its agent, and only the holder works on it and is woken", async (t) => {
  const h = await hub(t);
  const [one, two, three] = [await h.inbox(), await h.inbox(), await h.inbox()];
  const a = await h.session({ box: one });
  await a.publish(planData());
  const register = (box, start) =>
    h.register(a.directory, box.target, start ? { start } : {});
  const clock = (iso) =>
    [new Date(iso).getHours(), new Date(iso).getMinutes()]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  // The holder running start again, after an interrupted turn, keeps it.
  const first = (await a.status()).body.holder;
  assert.equal((await register(one, true)).code, 200);
  assert.deepEqual((await a.status()).body.holder, first);
  // An agent that never held it hears who has held it since when, and how
  // to take it over, not that anyone took it over.
  assert.equal(
    (await a.action("ack", { agent: three.agent })).body.error,
    `Another agent has run this session since ${clock(first.at)}, so stop working on it. If the reviewer asks you to take it over, run pair start --session-dir ${a.directory}.`,
  );
  // Another agent's start takes it over, and the reviewer's card says so.
  // That agent may never have read the core, so its next step starts there.
  await sleep(5);
  const took = await register(two, true);
  assert.equal(took.code, 200);
  assert.match(
    took.body.next,
    /^If you have not run pair guide in this conversation, run it first\. /,
  );
  const { holder, takeover } = (await a.status()).body;
  assert.equal(holder.harness, "claude-code");
  assert.notEqual(holder.at, first.at);
  assert.deepEqual(takeover, { name: "Claude Code", at: holder.at });
  // The first agent's next command, start included, is refused with the time
  // it lost the session, so it stops instead of taking the session back.
  const lost = await register(one, true);
  assert.equal(lost.code, 409);
  assert.equal(
    lost.body.error,
    `Another agent took this session over at ${clock(holder.at)}. Stop working on it.`,
  );
  // After that it is refused as any agent that does not hold the session.
  for (const refused of [
    await a.action("ack"),
    await a.action("publish", { html: "" }),
  ]) {
    assert.equal(refused.code, 409);
    assert.match(
      refused.body.error,
      /^Another agent has run this session since /,
    );
  }
  assert.deepEqual((await a.status()).body.holder, holder);
  assert.equal((await a.action("ack", { agent: two.agent })).code, 200);
  // Only the holder is woken, and the card's takeover line lasts until the
  // reviewer sends again.
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal(await waitUntil(() => two.wakes.length === 1), true);
  assert.equal(one.wakes.length, 0);
  assert.equal((await a.status()).body.takeover, null);
  // The handoff line hands the session back to the first agent.
  assert.equal((await register(one, true)).code, 200);
  assert.equal((await a.action("read")).code, 200);
  assert.equal((await a.action("ack", { agent: two.agent })).code, 409);
});

// A former holder, or a plain terminal with no agent, can read the status,
// and the former holder still hears of the takeover on its next command.
test("status answers any agent or none, and keeps the takeover notice", async (t) => {
  const h = await hub(t);
  const two = await h.inbox();
  const a = await h.session();
  await a.publish(planData());
  const took = await h.register(a.directory, two.target, { start: true });
  assert.equal(took.code, 200);
  // A command registers before it runs when the hub has exited since, as
  // after 15 minutes with no live session.
  const { holder } = (await a.status()).body;
  const again = await h.register(a.directory, a.inbox.target);
  assert.equal(again.code, 200, again.body.error);
  assert.deepEqual((await a.status()).body.holder, holder);
  assert.equal((await a.action("status")).code, 200);
  assert.equal((await a.action("status", { agent: undefined })).code, 200);
  const lost = await a.action("ack");
  assert.equal(lost.code, 409);
  assert.match(lost.body.error, /^Another agent took this session over at /);
});
