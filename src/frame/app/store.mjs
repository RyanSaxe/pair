import { $ } from "#frame/app/util.mjs";
import { editable, prefsPrefix, storageKey } from "#frame/app/view.mjs";
import { review } from "#frame/review/review.mjs";
import { selectedTab } from "#frame/sync/rounds.mjs";

export const record = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const filterValues = (object, keep) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => keep(value)));
const mapValues = (object, fn) =>
  Object.fromEntries(
    Object.entries(object).map(([key, value]) => [key, fn(value)]),
  );

export function emptyDraft(round) {
  return {
    round,
    alignUnflagged: true,
    notes: [],
    choices: {},
    answers: {},
    // The text typed into each question, before and after its Answer.
    drafts: {},
    noteDrafts: {},
    submitted: null,
    pending: null,
  };
}

// Drafts are keyed by session and name, not round. When a new round
// lands, items that were already sent are dropped and unsent items carry over.
export function loadDraft(saved, round) {
  if (!record(saved) || !Array.isArray(saved.notes) || !record(saved.choices))
    return emptyDraft(round);
  const draft = { ...emptyDraft(round), ...saved };
  if (saved.round !== round) {
    draft.notes = draft.notes.filter((note) => !note.sentIn);
    draft.choices = filterValues(draft.choices, (choice) => !choice.sentIn);
    draft.answers = filterValues(draft.answers, (answer) => !answer.sentIn);
    draft.submitted = null;
    draft.pending = null;
    draft.round = round;
  }
  return draft;
}

// A checklist counts toward the header count only once the reviewer touched
// it. An untouched list is still sent with the round, as the reviewer left it.
const counted = (choice) =>
  !choice.sentIn && (choice.kind !== "multiple" || choice.touched === true);

export function unsentItems(draft) {
  const notes = draft.notes.filter((note) => !note.sentIn);
  const choices = filterValues(draft.choices, counted);
  const answers = filterValues(draft.answers, (answer) => !answer.sentIn);
  return {
    notes,
    choices,
    answers,
    count:
      notes.length + Object.keys(choices).length + Object.keys(answers).length,
  };
}

// The words behind the count: notes and written answers are comments, and
// picked options and touched checklists are choices.
export function draftedWords(draft) {
  const { notes, choices, answers } = unsentItems(draft);
  const count = (number, word) =>
    number ? `${number} ${word}${number === 1 ? "" : "s"}` : "";
  return [
    count(notes.length + Object.keys(answers).length, "comment"),
    count(Object.keys(choices).length, "choice"),
  ]
    .filter(Boolean)
    .join(" and ");
}

export function submissionGroups(draft) {
  const { notes, answers } = unsentItems(draft);
  const choices = filterValues(draft.choices, (choice) => !choice.sentIn);
  const strip = ({ sentIn, ...item }) => item;
  return {
    alignUnflagged: draft.alignUnflagged,
    choices: mapValues(choices, strip),
    notes: notes.map(strip),
    ...(Object.keys(answers).length
      ? { answers: mapValues(answers, strip) }
      : {}),
  };
}

// A sent item does not carry over to the next round's draft. A sent answer's
// typed text goes with it, so the next round's question starts empty.
export function markSent(draft, id, at) {
  const { count } = unsentItems(draft);
  for (const note of draft.notes) note.sentIn ||= id;
  for (const choice of Object.values(draft.choices)) choice.sentIn ||= id;
  for (const [key, answer] of Object.entries(draft.answers)) {
    answer.sentIn ||= id;
    delete draft.drafts[key];
  }
  draft.submitted = { id, at, round: draft.round, count };
  draft.pending = null;
  return draft;
}

export let state;
export function setState(draft) {
  state = draft;
}
// The draft this browser saved for Current, carried over to the round.
export function savedDraft(round) {
  try {
    return loadDraft(JSON.parse(localStorage.getItem(storageKey)), round);
  } catch {
    /* The in-memory draft and export remain usable. */
    return emptyDraft(round);
  }
}
// The draft another tab of the session saved, when it is for the round this
// tab holds. A draft for another round is not this tab's to take over.
export function storedDraft(value, round) {
  try {
    const saved = JSON.parse(value);
    return saved?.round === round ? loadDraft(saved, round) : null;
  } catch {
    return null;
  }
}
export const prefs = {
  get(key) {
    try {
      return localStorage.getItem(prefsPrefix + key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null || value === undefined)
        localStorage.removeItem(prefsPrefix + key);
      else localStorage.setItem(prefsPrefix + key, String(value));
    } catch {
      /* Preferences are conveniences; nothing depends on them. */
    }
  },
};

export function persist() {
  if (!editable || selectedTab !== "current") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    $("storage-status").textContent = "";
  } catch {
    $("storage-status").textContent =
      "Local storage unavailable. Export a copy to keep your feedback.";
  }
}
export function save() {
  persist();
  review();
}
