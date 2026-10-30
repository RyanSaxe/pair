import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../../src/cli/build.mjs";
import { hub, planData, sleep, task, waitUntil } from "../../support/hub.mjs";

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
  // The holder may run start again, as after an interrupted turn, and stays the
  // holder.
  const first = (await a.status()).body.holder;
  assert.equal((await register(one, true)).code, 200);
  assert.deepEqual((await a.status()).body.holder, first);
  assert.equal(
    (await a.action("ack", { agent: three.agent })).body.error,
    `Another agent has run this session since ${clock(first.at)}, so stop working on it. If the reviewer asks you to take it over, run pair start --session-dir ${a.directory}.`,
  );
  // The new holder may never have run pair guide, so the next step that the hub
  // returns to it begins with pair guide.
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
  // The hub refuses the former holder's next command, start included, with the
  // time it lost the session, so that agent stops instead of taking the session
  // back.
  const lost = await register(one, true);
  assert.equal(lost.code, 409);
  assert.equal(
    lost.body.error,
    `Another agent took this session over at ${clock(holder.at)}. Stop working on it.`,
  );
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
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal(await waitUntil(() => two.wakes.length === 1), true);
  assert.equal(one.wakes.length, 0);
  assert.equal((await a.status()).body.takeover, null);
  // The first agent takes the session back by running the pair start command in
  // the handoff line.
  assert.equal((await register(one, true)).code, 200);
  assert.equal((await a.action("read")).code, 200);
  assert.equal((await a.action("ack", { agent: two.agent })).code, 409);
});

test("status answers any agent or none, and keeps the takeover notice", async (t) => {
  const h = await hub(t);
  const two = await h.inbox();
  const a = await h.session();
  await a.publish(planData());
  const took = await h.register(a.directory, two.target, { start: true });
  assert.equal(took.code, 200);
  // A command registers the session before it runs if the hub has exited since
  // the last command, as a hub does after 15 minutes with no live session.
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

// The previous holder read the feedback that the open round answers before it
// published the round's Agreed. pair read prints nothing new to the agent that
// takes the round over, so the hub's answer to its start contains that
// submission's ID.
test("a start that takes over an open round names the submission the round answers", async (t) => {
  const h = await hub(t);
  const two = await h.inbox();
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const feedback = a.event();
  assert.equal((await a.feedback(feedback)).code, 200);
  assert.equal((await a.action("read")).code, 200);
  const { name, title } = planData();
  const agreed = await buildPage(path.join(a.directory, "source.json"), {
    name,
    round: "2",
    title,
    page: { id: "agreed", title: "Agreed so far", task, agreements: [] },
  });
  const opened = await a.action("publish", {
    html: agreed,
    pages: [{ id: "overview", title: "Overview" }],
  });
  assert.equal(opened.code, 200, opened.body.error);
  const took = await h.register(a.directory, two.target, { start: true });
  assert.equal(took.code, 200);
  assert.equal(
    took.body.next,
    `If you have not run pair guide in this conversation, run it first. This round answers the reviewer's feedback in submission ${feedback.id}, which the previous agent read. Run pair read --session-dir ${a.directory} --submission ${feedback.id} to read it. You still have to publish these pages: overview. None of them has started. Each time you or a subagent begin work on a page, run pair progress --page ID --note "…" for that page right away, with a note on what is being done, and run it again at least every five minutes until you publish it. Publish each page with pair publish as soon as pair build has built it.`,
  );
});

test("a start that takes over before the next Agreed names the feedback the previous holder read", async (t) => {
  const h = await hub(t);
  const two = await h.inbox();
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const feedback = a.event();
  assert.equal((await a.feedback(feedback)).code, 200);
  assert.equal((await a.action("read")).code, 200);
  const took = await h.register(a.directory, two.target, { start: true });
  assert.equal(took.code, 200);
  assert.equal(
    took.body.next,
    `If you have not run pair guide in this conversation, run it first. The next round answers the reviewer's feedback in submission ${feedback.id}, which the previous agent read. Run pair read --session-dir ${a.directory} --submission ${feedback.id} to read it. Edit Agreed's task and alignments to match this feedback. Then publish Agreed with the round's page list, using pair publish, within a few minutes and before you research or write any other page.`,
  );
});

test("a start that takes over names no submission after a complete round, or for feedback no agent has read", async (t) => {
  const h = await hub(t);
  const [two, three] = [await h.inbox(), await h.inbox()];
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal((await a.action("read")).code, 200);
  assert.equal((await a.publish(planData("2"))).code, 200);
  const complete = await h.register(a.directory, two.target, { start: true });
  assert.doesNotMatch(complete.body.next, /--submission/);
  assert.equal((await a.feedback(a.event("feedback-only", "2"))).code, 200);
  const unread = await h.register(a.directory, three.target, { start: true });
  assert.equal(
    unread.body.next,
    `If you have not run pair guide in this conversation, run it first. Run pair read --session-dir ${a.directory} to see what the reviewer sent.`,
  );
});
