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
  const wire = (value) => JSON.parse(JSON.stringify(value));
  let hub = { id: "h1", revision: 0, items: {} };
  return {
    get hub() {
      return wire(hub);
    },
    device: (round = "1") => emptyDraft(round),
    // push sends a browser's changes and merges the hub's answer, as push()
    // in src/frame/sync/draft.mjs does.
    push(draft) {
      const changes = wire(draftChanges(draft));
      hub = wire(applyChanges(hub, changes));
      recordPushed(draft, changes, hub);
      mergeDraft(draft, wire(hub));
    },
    pull: (draft, copy = hub) => mergeDraft(draft, wire(copy)),
    sync(draft) {
      this.pull(draft);
      this.push(draft);
    },
    send(draft, id = "s1") {
      // The payload has the field of submission() in
      // src/frame/review/send.mjs that applySubmission reads.
      hub = wire(
        applySubmission(hub, wire({ groups: submissionGroups(draft) })),
      );
      markSent(draft, id, "2026-10-29T00:00:00Z");
    },
    reset() {
      hub = { id: "h2", revision: 0, items: {} };
    },
  };
}
// The tabs of a session in one browser save one copy of the draft, and each
// tab loads the copy that another tab saved, as installDraftSync() does.
const reopen = (draft) => storedDraft(JSON.stringify(draft), draft.round);
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
const answer = (text) => ({
  topic: "overview",
  label: "Why",
  text,
  round: "1",
});
const texts = (draft) => draft.notes.map((item) => item.text);

test("what the reviewer completed in one browser reaches the other, and text typed before its button does not", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  phone.notes.push(note("n1", "Rename the flag."));
  phone.choices["overview/approach"] = choice("queue");
  phone.answers["overview/why"] = answer("Because retries pile up.");
  phone.alignUnflagged = false;
  phone.drafts["overview/limit"] = "Typed, but Answer not pressed.";
  phone.noteDrafts['["overview","Overview","",null,null]'] = "Half a note.";
  phone.replyDrafts.t1 = { text: "Half a reply.", attachments: [] };
  phone.message = "Typed in the Send popup.";
  w.sync(phone);
  assert.deepEqual(Object.keys(w.hub.items).sort(), [
    "alignUnflagged",
    "answer/overview/why",
    "choice/overview/approach",
    "note/n1",
  ]);
  w.pull(computer);
  assert.deepEqual(texts(computer), ["Rename the flag."]);
  assert.equal(computer.choices["overview/approach"].value, "queue");
  assert.equal(
    computer.answers["overview/why"].text,
    "Because retries pile up.",
  );
  assert.equal(computer.alignUnflagged, false);
  assert.deepEqual(computer.drafts, {});
  assert.deepEqual(computer.noteDrafts, {});
  assert.deepEqual(computer.replyDrafts, {});
  assert.equal(computer.message, "");
  assert.deepEqual(draftChanges(computer), {});
});

// Two tabs share the saved draft and its synced record, but each tab reads
// the hub's draft on its own, so one tab can hold a copy older than the
// merge the other tab saved. Merging that copy changed the record, the save
// woke the other tab, and the two tabs rewrote the draft without end.
test("a tab with an older copy of the hub's draft leaves the draft that another tab merged as it was", () => {
  const w = world();
  const first = w.device();
  first.notes.push(note("n1", "Cut the video to fifteen seconds."));
  const before = w.hub;
  w.push(first);
  const alive = w.hub;
  const second = reopen(first);
  const saved = JSON.stringify(second);
  w.pull(second, before);
  assert.equal(JSON.stringify(second), saved);
  // The first tab deletes the note. The second tab still holds the copy in
  // which the note exists, and merging it must not bring the note back.
  first.notes = [];
  w.push(first);
  const after = reopen(first);
  w.pull(after, alive);
  assert.deepEqual(texts(after), []);
  assert.deepEqual(draftChanges(after), {});
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

test("a deleted note stays deleted, and an edit saved after the delete survives as a new note", () => {
  for (const deleteFirst of [true, false]) {
    const w = world();
    const phone = w.device(),
      computer = w.device();
    phone.notes.push(note("n1", "First."));
    w.sync(phone);
    w.sync(computer);
    phone.notes = [];
    computer.notes[0] = note("n1", "An edit saved in an open dialog.");
    if (deleteFirst) {
      w.push(phone);
      w.sync(computer);
      w.sync(computer);
    } else {
      w.push(computer);
      w.sync(phone);
      w.pull(computer);
    }
    w.pull(phone);
    const label = `delete first: ${deleteFirst}`;
    // The edit reaches the hub after the delete only when the reviewer saved
    // it without seeing the delete, so the frame keeps those words.
    const kept = deleteFirst ? ["An edit saved in an open dialog."] : [];
    assert.deepEqual(texts(phone), kept, label);
    assert.deepEqual(texts(computer), kept, label);
    assert.equal(w.hub.items["note/n1"].value, null, label);
    assert.ok(
      [...phone.notes, ...computer.notes].every((item) => item.id !== "n1"),
      label,
    );
    assert.deepEqual(draftChanges(computer), {}, label);
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

test("an answer changed on another device replaces the text of the old answer here, and keeps text typed since", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  // Answer keeps the typed text in the draft, and the box shows it first.
  phone.drafts["overview/why"] = "First.";
  phone.answers["overview/why"] = answer("First.");
  w.sync(phone);
  w.sync(computer);
  computer.answers["overview/why"] = answer("Second.");
  w.push(computer);
  w.pull(phone);
  assert.equal(phone.answers["overview/why"].text, "Second.");
  assert.equal(phone.drafts["overview/why"], undefined);
  phone.drafts["overview/why"] = "Typed since.";
  computer.answers["overview/why"] = answer("Third.");
  w.push(computer);
  w.pull(phone);
  assert.equal(phone.answers["overview/why"].text, "Third.");
  assert.equal(phone.drafts["overview/why"], "Typed since.");
});

test("a send in one browser clears the sent items in the other and keeps the rest", () => {
  const w = world();
  const phone = w.device(),
    computer = w.device();
  phone.notes.push(note("n1", "Sent."));
  phone.choices["overview/approach"] = choice("queue");
  phone.answers["overview/why"] = answer("Retries.");
  w.sync(phone);
  w.sync(computer);
  computer.drafts["overview/why"] = "Retries.";
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
  const second = reopen(first);
  w.push(first);
  const revision = w.hub.revision;
  w.sync(second);
  assert.equal(w.hub.revision, revision);
  assert.deepEqual(texts(second), ["Typed in the first tab."]);
  assert.deepEqual(draftChanges(second), {});
});

test("a hub that starts a new draft gets the browser's whole draft", () => {
  const w = world();
  const phone = w.device();
  phone.notes.push(note("n1", "Kept here."));
  w.sync(phone);
  assert.deepEqual(draftChanges(phone), {});
  w.reset();
  w.pull(phone);
  assert.deepEqual(Object.keys(draftChanges(phone)), ["note/n1"]);
});
