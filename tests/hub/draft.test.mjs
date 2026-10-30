import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
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

test("the hub keeps a session's completed items, numbers each change, and keeps them across a restart", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const route = `${a.base}/api/draft`;
  const empty = (await a.request(route)).body;
  assert.deepEqual({ ...empty, id: "" }, { id: "", revision: 0, items: {} });
  const changed = await a.request(route, {
    changes: { "note/n1": note("n1", "Rename it."), alignUnflagged: false },
  });
  assert.equal(changed.code, 200, changed.body.error);
  assert.equal(changed.body.revision, 2);
  const status = (await a.status()).body;
  assert.equal(status.draftRevision, 2);
  assert.equal(status.draftId, empty.id);
  // A change to an equal value is not a change, so the revision stays.
  await a.request(route, { changes: { alignUnflagged: false } });
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

// Typed text stays in the browser it was typed in, so the hub refuses the
// kinds of item that held it in the draft.json of an earlier version.
test("the draft refuses another site's page, text typed before its button, and a change that is not a draft item", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const route = `${a.base}/api/draft`;
  const refused = await a.request(
    route,
    { changes: { alignUnflagged: false } },
    { Origin: "http://evil" },
  );
  assert.equal(refused.code, 403);
  for (const changes of [
    { notes: [] },
    { "note/n1": note("n2", "Another ID.") },
    { "noteDraft/unsaved": "Still typing." },
    { "replyDraft/t1": { text: "Half a reply.", attachments: [] } },
    { "draft/overview/why": "Typed before Answer." },
    { message: "Typed in the Send popup." },
    { alignUnflagged: "no" },
  ])
    assert.equal((await a.request(route, { changes })).code, 400);
  assert.equal((await a.request(route)).body.revision, 0);
});

test("a draft.json without an id starts a new empty draft", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  await h.server.close();
  const older = {
    revision: 293,
    items: {
      'noteDraft/["final15","The final launch video","",null,null]': {
        rev: 293,
        value: "Text already sent as a thread.",
      },
    },
  };
  await fs.writeFile(
    path.join(a.directory, "draft.json"),
    JSON.stringify(older),
  );
  const next = await startHub(h.config);
  t.after(next.close);
  const draft = await (await fetch(`${next.origin}${a.base}/api/draft`)).json();
  assert.equal(typeof draft.id, "string");
  assert.deepEqual({ ...draft, id: "" }, { id: "", revision: 0, items: {} });
});

test("a submission removes the items it sent and keeps an item changed since", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const route = `${a.base}/api/draft`;
  const choice = { topic: "overview", label: "Approach", value: "queue" };
  const answer = { topic: "overview", label: "Why", text: "Retries." };
  const changed = await a.request(route, {
    changes: {
      "note/n1": note("n1", "Sent."),
      "note/n2": note("n2", "Edited on another device."),
      "choice/overview/approach": choice,
      "answer/overview/why": answer,
      alignUnflagged: false,
    },
  });
  assert.equal(changed.code, 200, changed.body.error);
  const sent = await a.feedback(
    a.event("feedback-only", "1", {
      groups: {
        alignUnflagged: false,
        notes: [note("n1", "Sent."), note("n2", "The text before the edit.")],
        choices: { "overview/approach": choice },
        answers: { "overview/why": answer },
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
    "answer/overview/why": null,
    alignUnflagged: false,
  });
  assert.equal(
    sent.body.status.draftRevision,
    (await a.request(route)).body.revision,
  );
});
