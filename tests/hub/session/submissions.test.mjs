import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readPlanData } from "../../../src/shared/records.mjs";
import { hub, planData, sleep } from "../../support/hub.mjs";

// Every browser counts the agent's running time from roundStartedAt: the
// session's creation for round 1, and then each submission.
test("the hub records when each round of the agent's work started", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const started = async () => (await a.status()).body.roundStartedAt;
  const receivedAt = async (event) =>
    JSON.parse(
      await fs.readFile(
        path.join(a.directory, "feedback", event.id + ".json"),
        "utf8",
      ),
    ).receivedAt;
  assert.ok(Number.isFinite(Date.parse(await started())));
  await a.publish(planData("1"));
  const first = a.event();
  await a.feedback(first);
  assert.equal(await started(), await receivedAt(first));
  await a.action("read");
  await a.publish(planData("2"));
  const second = a.event("feedback-only", "2");
  await a.feedback(second);
  assert.equal(await started(), await receivedAt(second));
});

// A round ends only with feedback, so the hub refuses an acceptance before it
// saves anything or wakes the agent.
test("the hub refuses a submission that accepts the round", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const refused = await a.feedback(
    a.event("accept", "1", { offer: "plan", action: "implement" }),
  );
  assert.equal(refused.code, 400);
  assert.equal(refused.body.error, "Invalid submission intent");
  assert.deepEqual(await fs.readdir(path.join(a.directory, "feedback")), []);
  await sleep(50);
  assert.equal(a.inbox.wakes.length, 0);
});

// Write a plan and Update the plan ask for a plan round, and Back to
// iterating sets one aside. After Keep iterating the agent decides.
test("the reviewer's choice for the next round decides whether Agreed may mark it a plan", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData("1"))).code, 200);
  async function send(round, next) {
    const sent = await a.feedback(a.event("feedback-only", round, { next }));
    assert.equal(sent.code, 200, sent.body.error);
    await a.action("read");
  }
  const publish = (round, plan) => a.publish({ ...planData(round), plan });

  await send("1", "plan");
  const unmarked = await publish("2", false);
  assert.equal(unmarked.code, 409);
  assert.match(unmarked.body.error, /asked for a plan/);
  assert.equal((await publish("2", true)).code, 200);

  await send("2", "iterate");
  const marked = await publish("3", true);
  assert.equal(marked.code, 409);
  assert.match(marked.body.error, /Back to iterating on plan round 2/);
  assert.equal((await publish("3", false)).code, 200);

  await send("3", "iterate");
  assert.equal((await publish("4", true)).code, 200);
  // The frame reads the mark from the round's data and the round list.
  for (const [round, plan] of [
    ["1", undefined],
    ["2", true],
  ])
    assert.equal(
      readPlanData((await a.request(`${a.base}/r/${round}`)).body).plan,
      plan,
    );
  const { rounds } = (await a.status()).body;
  assert.deepEqual(
    rounds.map((item) => [item.round, item.plan ?? false]),
    [
      ["1", false],
      ["2", true],
      ["3", false],
      ["4", true],
    ],
  );
});

test("the hub refuses a next round it does not know and a message over 4,000 characters", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  for (const [extra, error] of [
    [{ next: "later" }, "next is one of iterate, plan, build"],
    [{ message: "x".repeat(4001) }, "The message exceeds 4,000 characters"],
  ]) {
    const refused = await a.feedback(a.event("feedback-only", "1", extra));
    assert.equal(refused.code, 400);
    assert.equal(refused.body.error, error);
  }
  assert.deepEqual(await fs.readdir(path.join(a.directory, "feedback")), []);
});

test("Build it records the round and the submission it was chosen from", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const event = a.event("feedback-only", "1", { next: "build" });
  assert.equal((await a.feedback(event)).code, 200);
  const { build } = JSON.parse(
    await fs.readFile(path.join(a.directory, "status.json"), "utf8"),
  );
  assert.equal(build.round, "1");
  assert.equal(build.submission, event.id);
  assert.ok(Number.isFinite(Date.parse(build.at)));
});
