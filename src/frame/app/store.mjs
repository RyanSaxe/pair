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
    message: "",
    notes: [],
    choices: {},
    answers: {},
    // drafts contains the text typed into each question, before and after its
    // Answer, and each drawing question's drawing since it was last saved.
    drafts: {},
    noteDrafts: {},
    replyDrafts: {},
    submitted: null,
    pending: null,
  };
}

// The frame keys a draft by session and plan name, not by round. When a new
// round arrives, loadDraft() drops the items that were already sent and keeps
// the unsent ones.
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

// A checklist counts toward the header count only after the reviewer touches
// it. The frame still sends an untouched checklist with the round, as the
// reviewer left it.
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

// markSent() deletes a sent answer's typed text or drawing, so the question
// starts empty in the next round.
export function markSent(draft, id, at) {
  const { count } = unsentItems(draft);
  for (const note of draft.notes) note.sentIn ||= id;
  for (const choice of Object.values(draft.choices)) choice.sentIn ||= id;
  for (const [key, answer] of Object.entries(draft.answers)) {
    answer.sentIn ||= id;
    delete draft.drafts[key];
  }
  draft.submitted = { id, at, round: draft.round, count };
  draft.message = "";
  draft.pending = null;
  return draft;
}

export let state;
export function setState(draft) {
  state = draft;
}
export function savedDraft(round) {
  try {
    return loadDraft(JSON.parse(localStorage.getItem(storageKey)), round);
  } catch {
    /* When localStorage throws, the in-memory draft and export still work. */
    return emptyDraft(round);
  }
}
// storedDraft() ignores a draft that another tab of the session saved for a
// different round, so this tab never takes over that draft.
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
      /* When localStorage throws, the preference is not saved, and no code
         depends on it. */
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
