import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { assemble } from "../../../src/build/assemble.mjs";
import { readPlanData } from "../../../src/shared/records.mjs";
import { hub, planData } from "../../support/hub.mjs";

test("publication resolves exact mixed sources from saved feedback before hashing", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const feedback = a.event("feedback-only", "1", {
    groups: {
      notes: [
        {
          id: "note-1",
          topic: "overview",
          anchor: "Failure handling",
          text: "Keep <strong>literal</strong> and </script> $&",
          quote: "A failed item",
          target: "failure",
        },
      ],
      choices: {
        "overview:errors": {
          topic: "overview",
          label: "Error policy",
          value: "per-item",
          target: "errors",
        },
      },
    },
  });
  assert.equal((await a.feedback(feedback)).code, 200);
  await a.action("read");
  const entry = {
    id: "errors",
    title: "Per-item errors",
    html: "<p>Keep successful results.</p>",
    sourceRefs: [
      { kind: "note", submissionId: feedback.id, noteId: "note-1" },
      {
        kind: "choice",
        submissionId: feedback.id,
        choiceId: "overview:errors",
      },
      {
        kind: "conversation",
        text: "Driver also confirmed the return type in conversation.",
      },
    ],
  };
  const data = { ...planData("2"), agreements: [entry] };
  const result = await a.publish(data);
  assert.equal(result.code, 200);
  const snapshot = await fs.readFile(
    path.join(a.directory, "rounds/example.2.html"),
    "utf8",
  );
  const records = readPlanData(snapshot).agreements[0].sourceRecords;
  assert.equal(records.length, 3);
  assert.equal(records[0].text, feedback.groups.notes[0].text);
  assert.equal(records[0].quote, "A failed item");
  assert.equal(records[0].target, "failure");
  assert.equal(records[0].href, "./example.1.html?target=failure#overview");
  assert.equal(records[1].text, "per-item");
  assert.equal(records[1].label, "Error policy");
  assert.equal(records[1].href, "./example.1.html?target=errors#overview");
  assert.deepEqual(records[2], entry.sourceRefs[2]);
  assert(!snapshot.includes(feedback.groups.notes[0].text));
  assert.equal(
    result.body.status.current.sha256,
    crypto.createHash("sha256").update(snapshot).digest("hex"),
  );
  await a.feedback(a.event("feedback-only", "2"));
  await a.action("read");
  for (const ref of [
    { kind: "note", submissionId: "missing", noteId: "note-1" },
    { kind: "note", submissionId: feedback.id, noteId: "missing" },
    { kind: "choice", submissionId: feedback.id, choiceId: "missing" },
  ]) {
    const rejected = await a.publish({
      ...data,
      round: "3",
      agreements: [{ ...entry, sourceRefs: [ref] }],
    });
    assert.equal(rejected.code, 400);
    assert.match(rejected.body.error, /Source .*not found/);
  }
  for (const sourceRefs of [
    [],
    [{ kind: "unknown" }],
    [{ kind: "conversation", text: "" }],
    [{ kind: "note", submissionId: feedback.id }],
    [{ kind: "answer", submissionId: feedback.id }],
  ])
    await assert.rejects(
      assemble({ ...data, agreements: [{ ...entry, sourceRefs }] }),
    );
});

test("choice sources preserve readable labels and complete checklist snapshots", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const choices = {
    "overview/policy": {
      topic: "overview",
      label: "Error policy",
      value: "per-item",
      valueLabel: "Keep successful results",
      target: "policy",
    },
    "overview/scope": {
      kind: "multiple",
      topic: "overview",
      label: "Scope",
      target: "scope",
      options: [
        { value: "labels", label: "Readable <labels>", checked: true },
        { value: "drafts", label: "Draft visibility", checked: false },
      ],
    },
    "overview/empty": {
      kind: "multiple",
      topic: "overview",
      label: "Optional work",
      target: "optional",
      options: [{ value: "extra", label: "Extra work", checked: false }],
    },
  };
  const feedback = a.event("feedback-only", "1", { groups: { choices } });
  assert.equal((await a.feedback(feedback)).code, 200);
  await a.action("read");
  const data = {
    ...planData("2"),
    agreements: [
      {
        id: "scope",
        title: "Scope",
        html: "<p>Preserve the selected work.</p>",
        sourceRefs: Object.keys(choices).map((choiceId) => ({
          kind: "choice",
          submissionId: feedback.id,
          choiceId,
        })),
      },
    ],
  };
  const published = await a.publish(data);
  assert.equal(published.code, 200);
  const html = await fs.readFile(
    path.join(a.directory, "rounds/example.2.html"),
    "utf8",
  );
  const sources = readPlanData(html).agreements[0].sourceRecords;
  assert.deepEqual(
    sources.map((source) => source.choice),
    Object.values(choices),
  );
  assert.deepEqual(
    sources.map((source) => source.text),
    ["Keep successful results", "Readable <labels>", "None selected"],
  );
  assert.equal(sources[1].href, "./example.1.html?target=scope#overview");
  assert(!html.includes("Readable <labels>"));
});

test("answers travel with feedback and resolve as agreement sources", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  for (const answers of [
    [],
    { "overview/q1": { label: "Sidebar?", topic: "overview" } },
    { "overview/q1": { label: "Sidebar?", topic: "overview", text: "  " } },
    { "overview/q1": null },
  ]) {
    const rejected = await a.feedback(
      a.event("feedback-only", "1", { groups: { answers } }),
    );
    assert.equal(rejected.code, 400);
  }
  const feedback = a.event("feedback-only", "1", {
    groups: {
      answers: {
        "overview/q1": {
          label: "Sidebar?",
          text: "Yes, keep the <sidebar>",
          topic: "overview",
          target: "question-overview-0",
        },
      },
    },
  });
  assert.equal((await a.feedback(feedback)).code, 200);
  const received = await a.action("read");
  assert.deepEqual(
    received.body.event.payload.groups.answers,
    feedback.groups.answers,
  );
  const entry = {
    id: "sidebar",
    title: "Keep the sidebar",
    html: "<p>Pages stay in the sidebar.</p>",
    sourceRefs: [
      { kind: "answer", submissionId: feedback.id, answerId: "overview/q1" },
    ],
  };
  const published = await a.publish({ ...planData("2"), agreements: [entry] });
  assert.equal(published.code, 200, published.body.error);
  const html = await fs.readFile(
    path.join(a.directory, "rounds/example.2.html"),
    "utf8",
  );
  const [record] = readPlanData(html).agreements[0].sourceRecords;
  assert.equal(record.kind, "answer");
  assert.equal(record.text, "Yes, keep the <sidebar>");
  assert.equal(record.label, "Sidebar?");
  assert.equal(record.target, "question-overview-0");
  assert.equal(
    record.href,
    "./example.1.html?target=question-overview-0#overview",
  );
  assert(!html.includes("Yes, keep the <sidebar>"));
  await a.feedback(a.event("feedback-only", "2"));
  await a.action("read");
  const missing = await a.publish({
    ...planData("3"),
    agreements: [
      {
        ...entry,
        sourceRefs: [
          { kind: "answer", submissionId: feedback.id, answerId: "nope" },
        ],
      },
    ],
  });
  assert.equal(missing.code, 400);
  assert.match(missing.body.error, /Source item not found/);
});

test("agreements survive topic changes and targeted feedback without rewriting snapshots", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const entry = {
    id: "errors",
    title: "Per-item errors",
    html: "<p>Keep each error.</p>",
    source: "User's answer",
  };
  const states = ["agreed", "reopened", "agreed", "retired"];
  for (const [index, state] of states.entries()) {
    const round = String(index + 1);
    const data = {
      ...planData(round),
      pages: [
        {
          id: `topic-${round}`,
          title: `Topic ${round}`,
          html: "<p>Current proposal</p>",
        },
      ],
      agreements: [{ ...entry, state }],
    };
    assert.equal((await a.publish(data)).code, 200);
    const event = a.event("feedback-only", round, {
      groups: {
        notes: [
          {
            id: crypto.randomUUID(),
            topic: "agreed",
            agreementId: entry.id,
            anchor: entry.title,
            round,
            text: "Reconsider the error type.",
          },
        ],
      },
    });
    assert.equal((await a.feedback(event)).code, 200);
    const received = await a.action("read");
    assert.equal(
      received.body.event.payload.groups.notes[0].agreementId,
      entry.id,
    );
    assert.equal(received.body.event.payload.intent, "feedback-only");
  }
  for (const [index, state] of states.entries()) {
    const snapshot = readPlanData(
      await fs.readFile(
        path.join(a.directory, `rounds/example.${index + 1}.html`),
        "utf8",
      ),
    );
    assert.equal(snapshot.agreements[0].state, state);
    assert.equal(snapshot.agreements[0].id, entry.id);
  }
  const status = (await a.status()).body;
  assert.deepEqual(
    status.rounds.map((item) => item.round),
    ["1", "2", "3", "4"],
  );
  assert.equal(status.rounds[0].url, `${a.base}/r/1`);
});
