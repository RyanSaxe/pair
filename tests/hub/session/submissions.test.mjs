import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
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
