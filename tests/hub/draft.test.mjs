import assert from "node:assert/strict";
import test from "node:test";
import { startHub } from "../../src/hub/server.mjs";
import { hub, planData } from "../support/hub.mjs";

const note = (id, text) => ({
  id,
  topic: "overview",
  anchor: "Overview",
  text,
  round: "1",
});

test("the hub keeps a session's draft, numbers each change, and keeps it across a restart", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const route = `${a.base}/api/draft`;
  assert.deepEqual((await a.request(route)).body, { revision: 0, items: {} });
  const changed = await a.request(route, {
    changes: { "note/n1": note("n1", "Rename it."), message: "Ship it." },
  });
  assert.equal(changed.code, 200, changed.body.error);
  assert.equal(changed.body.revision, 2);
  assert.equal((await a.status()).body.draftRevision, 2);
  // A change to an equal value is not a change, so the revision stays.
  await a.request(route, { changes: { message: "Ship it." } });
  await a.request(route, { changes: { "note/n1": null } });
  const late = await a.request(route, {
    changes: { "note/n1": note("n1", "An edit after the delete.") },
  });
  assert.deepEqual(late.body.items["note/n1"], { rev: 3, value: null });
  await h.server.close();
  const next = await startHub(h.config);
  t.after(next.close);
  const reread = await fetch(`${next.origin}${route}`);
  assert.deepEqual(await reread.json(), late.body);
});

test("the draft refuses another site's page and a change that is not a draft item", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const route = `${a.base}/api/draft`;
  const refused = await a.request(
    route,
    { changes: { message: "From elsewhere." } },
    { Origin: "http://evil" },
  );
  assert.equal(refused.code, 403);
  for (const changes of [
    { notes: [] },
    { "note/n1": note("n2", "Another ID.") },
    { "unknown/x": "text" },
    { message: 4 },
  ])
    assert.equal((await a.request(route, { changes })).code, 400);
  assert.equal((await a.request(route)).body.revision, 0);
});

test("a submission removes the items it sent and keeps an item changed since", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const route = `${a.base}/api/draft`;
  const choice = { topic: "overview", label: "Approach", value: "queue" };
  await a.request(route, {
    changes: {
      "note/n1": note("n1", "Sent."),
      "note/n2": note("n2", "Edited on another device."),
      "choice/overview/approach": choice,
      "draft/overview/why": "Retries.",
      "answer/overview/why": {
        topic: "overview",
        label: "Why",
        text: "Retries.",
      },
      "noteDraft/unsaved": "Still typing.",
    },
  });
  const sent = await a.feedback(
    a.event("feedback-only", "1", {
      groups: {
        notes: [note("n1", "Sent."), note("n2", "The text before the edit.")],
        choices: { "overview/approach": choice },
        answers: {
          "overview/why": { topic: "overview", label: "Why", text: "Retries." },
        },
      },
    }),
  );
  assert.equal(sent.code, 200, sent.body.error);
  const { items } = (await a.request(route)).body;
  const values = Object.fromEntries(
    Object.entries(items).map(([key, item]) => [key, item.value]),
  );
  assert.deepEqual(values, {
    "note/n1": null,
    "note/n2": note("n2", "Edited on another device."),
    "choice/overview/approach": null,
    "draft/overview/why": null,
    "answer/overview/why": null,
    "noteDraft/unsaved": "Still typing.",
  });
  assert.equal(
    sent.body.status.draftRevision,
    (await a.request(route)).body.revision,
  );
});
