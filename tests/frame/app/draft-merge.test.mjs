import assert from "node:assert/strict";
import { test } from "node:test";
import {
  draftChanges,
  mergeDraft,
  recordPushed,
} from "../../../src/frame/app/draft-merge.mjs";
import {
  emptyDraft,
  loadDraft,
  markSent,
  storedDraft,
  submissionGroups,
  unsentItems,
} from "../../../src/frame/app/store.mjs";
import {
  applyChanges,
  applySubmission,
} from "../../../src/hub/session/draft.mjs";

// world() stands for one hub and the browsers that share its draft. It
// passes each value through JSON, as HTTP and localStorage do, so no browser
// shares an object with the hub.
function world() {
  let hub = { revision: 0, items: {} };
  const wire = (value) => JSON.parse(JSON.stringify(value));
  return {
    get hub() {
      return hub;
    },
    set hub(next) {
      hub = JSON.parse(JSON.stringify(next));
    },
    device: (round = "1") => emptyDraft(round),
    // push sends a browser's changes and merges the hub's answer, as push()
    // in src/frame/sync/draft.mjs does.
    push(draft) {
      const changes = wire(draftChanges(draft));
      hub = wire(applyChanges(hub, changes));
      recordPushed(draft, changes, hub);
      mergeDraft(draft, hub);
    },
    pull: (draft, options) => mergeDraft(draft, wire(hub), options),
    sync(draft) {
      this.pull(draft);
      this.push(draft);
    },
    send(draft, id = "s1") {
      // The payload has the fields of submission() in
      // src/frame/review/send.mjs that applySubmission reads.
      const message = draft.message.trim();
      const payload = wire({
        groups: submissionGroups(draft),
        ...(message ? { message } : {}),
      });
      hub = wire(applySubmission(hub, payload));
      markSent(draft, id, "2026-10-29T00:00:00Z");
    },
  };
}
const note = (id, text, topic = "overview") => ({
  topic,
  anchor: "Overview",
  id,
  text,
  round: "1",
});
const choice = (value) => ({
  topic: "overview",
  label: "Approach",
  value,
  valueLabel: value,
  target: "choice-overview-0",
  round: "1",
});
const texts = (draft) => draft.notes.map((item) => item.text);

test("a note, a choice and a typed answer made in one browser reach the other", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  phone.notes.push(note("n1", "Rename the flag."));
  phone.choices["overview/approach"] = choice("queue");
  phone.drafts["overview/why"] = "Because retries pile up.";
  w.sync(phone);
  assert.equal(w.pull(computer), true);
  assert.deepEqual(texts(computer), ["Rename the flag."]);
  assert.equal(computer.choices["overview/approach"].value, "queue");
  assert.equal(computer.drafts["overview/why"], "Because retries pile up.");
  assert.deepEqual(draftChanges(computer), {});
});

test("when both browsers edit one note, the change the hub receives later wins", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  phone.notes.push(note("n1", "First."));
  w.sync(phone);
  w.sync(computer);
  phone.notes[0] = note("n1", "Phone's edit.");
  computer.notes[0] = note("n1", "Computer's edit.");
  w.push(phone);
  // The computer has not sent its edit yet, so a merge keeps it.
  w.pull(computer);
  assert.deepEqual(texts(computer), ["Computer's edit."]);
  w.push(computer);
  w.pull(phone);
  assert.deepEqual(texts(phone), ["Computer's edit."]);
  assert.deepEqual(texts(computer), ["Computer's edit."]);
});

test("a deleted note stays deleted, whichever change reaches the hub first", () => {
  for (const deleteFirst of [true, false]) {
    const w = world();
    const phone = w.device(),
      computer = w.device();
    phone.notes.push(note("n1", "First."));
    w.sync(phone);
    w.sync(computer);
    phone.notes = [];
    computer.notes[0] = note("n1", "An edit made before the delete arrived.");
    if (deleteFirst) {
      w.push(phone);
      w.sync(computer);
    } else {
      w.push(computer);
      w.sync(phone);
      w.pull(computer);
    }
    w.pull(phone);
    assert.deepEqual(texts(phone), [], `delete first: ${deleteFirst}`);
    assert.deepEqual(texts(computer), [], `delete first: ${deleteFirst}`);
    assert.deepEqual(draftChanges(computer), {});
  }
});

test("a cleared choice and a choice picked again both follow the later change", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  phone.choices["overview/approach"] = choice("queue");
  w.sync(phone);
  w.sync(computer);
  delete phone.choices["overview/approach"];
  w.push(phone);
  w.pull(computer);
  assert.equal(computer.choices["overview/approach"], undefined);
  computer.choices["overview/approach"] = choice("batch");
  w.push(computer);
  w.pull(phone);
  assert.equal(phone.choices["overview/approach"].value, "batch");
});

test("a send in one browser clears the sent items in the other and keeps the rest", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  phone.notes.push(note("n1", "Sent."));
  phone.choices["overview/approach"] = choice("queue");
  phone.answers["overview/why"] = {
    topic: "overview",
    label: "Why",
    text: "Retries.",
    round: "1",
  };
  phone.drafts["overview/why"] = "Retries.";
  phone.message = "Ship it.";
  w.sync(phone);
  w.sync(computer);
  // Each browser builds an untouched checklist from the page, and the send
  // carries the phone's copy.
  for (const draft of [phone, computer])
    draft.choices["overview/scope"] = {
      kind: "multiple",
      topic: "overview",
      label: "Scope",
      touched: false,
      options: [{ value: "a", label: "A", checked: true }],
    };
  // The computer adds a note that the phone has not merged when it sends.
  computer.notes.push(note("n2", "Written on the computer during the send."));
  w.push(computer);
  w.send(phone);
  assert.deepEqual(draftChanges(phone), {});
  w.pull(computer);
  assert.deepEqual(texts(computer), [
    "Written on the computer during the send.",
  ]);
  assert.deepEqual(computer.choices, {});
  assert.deepEqual(computer.answers, {});
  assert.deepEqual(computer.drafts, {});
  assert.equal(computer.message, "");
  // The phone keeps what it sent until the next round, and the unsent note
  // reaches it.
  w.pull(phone);
  assert.equal(phone.notes.find((item) => item.id === "n1").sentIn, "s1");
  const next = loadDraft(JSON.parse(JSON.stringify(phone)), "2");
  w.pull(next);
  assert.deepEqual(texts(next), ["Written on the computer during the send."]);
  assert.equal(unsentItems(next).count, 1);
});

test("a send removes a checklist that the sending browser rebuilt with another target", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  const list = (target) => ({
    kind: "multiple",
    topic: "overview",
    label: "Which failures are retried",
    target,
    round: "1",
    touched: true,
    options: [
      { value: "5xx", label: "5xx responses", checked: true },
      { value: "timeouts", label: "Timeouts", checked: false },
    ],
  });
  // A tick on the page records the checklist with the live block's ID, and
  // initializeChecklists() rebuilds it before a send with the ID it gives
  // the page's copy.
  computer.choices["overview/retryable"] = list("block-overview-1");
  w.sync(computer);
  w.sync(phone);
  phone.choices["overview/retryable"] = list("multiselect-overview-0");
  w.send(phone);
  w.pull(computer);
  assert.deepEqual(computer.choices, {});
  const next = loadDraft(JSON.parse(JSON.stringify(phone)), "2");
  w.pull(next);
  assert.deepEqual(next.choices, {});
});

test("a send leaves an item that another browser changed after the sender's last merge", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  phone.notes.push(note("n1", "Old text."));
  w.sync(phone);
  w.sync(computer);
  computer.notes[0] = note("n1", "New text the phone never saw.");
  w.push(computer);
  w.send(phone);
  w.pull(computer);
  assert.deepEqual(texts(computer), ["New text the phone never saw."]);
  const next = loadDraft(JSON.parse(JSON.stringify(phone)), "2");
  w.pull(next);
  assert.deepEqual(texts(next), ["New text the phone never saw."]);
});

test("edits made while the hub was unreachable reach it on the next sync", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  phone.notes.push(note("n1", "Shared."));
  w.sync(phone);
  w.sync(computer);
  // The phone is offline for these edits, while the computer keeps syncing.
  phone.notes.push(note("n2", "Written offline."));
  phone.notes[0] = note("n1", "Edited offline.");
  phone.choices["overview/approach"] = choice("queue");
  computer.notes.push(note("n3", "Written on the computer."));
  w.sync(computer);
  w.sync(phone);
  w.pull(computer);
  for (const draft of [phone, computer])
    assert.deepEqual(
      new Set(texts(draft)),
      new Set([
        "Edited offline.",
        "Written offline.",
        "Written on the computer.",
      ]),
    );
  assert.equal(computer.choices["overview/approach"].value, "queue");
});

test("a reload keeps what the browser synced, so it sends only its own changes", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  phone.notes.push(note("n1", "Shared."), note("n2", "Also shared."));
  w.sync(phone);
  w.sync(computer);
  const reloaded = loadDraft(JSON.parse(JSON.stringify(computer)), "1");
  assert.deepEqual(draftChanges(reloaded), {});
  phone.notes = phone.notes.filter((item) => item.id !== "n2");
  w.push(phone);
  w.sync(reloaded);
  assert.deepEqual(texts(reloaded), ["Shared."]);
  // A browser with no saved draft, such as one whose localStorage is blocked,
  // starts from the hub's.
  const fresh = w.device();
  w.sync(fresh);
  assert.deepEqual(texts(fresh), ["Shared."]);
  assert.deepEqual(draftChanges(fresh), {});
});

test("two tabs in one browser send the same change once", () => {
  const w = world();
  const first = w.device();
  first.notes.push(note("n1", "Typed in the first tab."));
  const second = storedDraft(JSON.stringify(first), "1");
  w.push(first);
  const revision = w.hub.revision;
  w.sync(second);
  assert.equal(w.hub.revision, revision);
  assert.deepEqual(texts(second), ["Typed in the first tab."]);
  assert.deepEqual(draftChanges(second), {});
});

test("a drawing in progress, a note being written and a reply draft with an image reach the other browser", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  const scene = {
    type: "excalidraw",
    elements: [{ id: "box", type: "rectangle", x: 10, y: 20 }],
    appState: { viewBackgroundColor: "#ffffff" },
  };
  const noteKey = JSON.stringify(["overview", "Overview", null]);
  const reply = {
    text: "The log is attached.",
    attachments: [{ id: "0123456789abcdef" }],
  };
  phone.drafts["overview/sketch"] = scene;
  phone.noteDrafts[noteKey] = "Half a note.";
  phone.replyDrafts.t1 = reply;
  w.sync(phone);
  assert.equal(w.pull(computer), true);
  assert.deepEqual(computer.drafts["overview/sketch"], scene);
  assert.equal(computer.noteDrafts[noteKey], "Half a note.");
  assert.deepEqual(computer.replyDrafts.t1, reply);
  assert.deepEqual(draftChanges(computer), {});
});

test("a note typed past the push that sent its draft leaves no draft behind once added", () => {
  const w = world();
  const computer = w.device(),
    fresh = w.device();
  const key = '["overview","Overview","dead-letter queue",null,null]';
  computer.noteDrafts[key] = "Who reads the";
  // The push of the first words returns while the reviewer is still typing
  // in the open note dialog, so the merge holds.
  const changes = JSON.parse(JSON.stringify(draftChanges(computer)));
  const hub = applyChanges(w.hub, changes);
  w.hub = hub;
  computer.noteDrafts[key] = "Who reads the dead-letter queue?";
  recordPushed(computer, changes, hub);
  mergeDraft(computer, hub, { hold: true });
  // Add to feedback adds the note and deletes its draft.
  computer.notes.push(note("n1", "Who reads the dead-letter queue?"));
  delete computer.noteDrafts[key];
  w.sync(computer);
  w.sync(fresh);
  assert.deepEqual(computer.noteDrafts, {});
  assert.deepEqual(fresh.noteDrafts, {});
  assert.deepEqual(texts(fresh), ["Who reads the dead-letter queue?"]);
});

test("a held merge keeps the text being typed and applies it later", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  phone.drafts["overview/why"] = "From the phone.";
  w.sync(phone);
  assert.equal(w.pull(computer, { hold: true }), false);
  assert.equal(computer.drafts["overview/why"], undefined);
  assert.equal(w.pull(computer), true);
  assert.equal(computer.drafts["overview/why"], "From the phone.");
});

test("a hub whose draft is older than the browser's gets the browser's whole draft", () => {
  const w = world();
  const phone = w.device();
  phone.notes.push(note("n1", "Kept here."));
  w.sync(phone);
  const restarted = { revision: 0, items: {} };
  mergeDraft(phone, restarted);
  assert.deepEqual(Object.keys(draftChanges(phone)), ["note/n1"]);
});
