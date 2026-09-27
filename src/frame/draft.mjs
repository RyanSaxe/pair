const record = (value) =>
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
    noteDrafts: {},
    submitted: null,
    pending: null,
  };
}

// Where the reader was in each round: the last page, and the scroll
// position on every page they read. Also which tab and past round were on
// screen.
export function readPlaces(saved) {
  const places = {};
  const offset = (value) => {
    const top = Number(value);
    return Number.isFinite(top) && top > 0 ? top : 0;
  };
  const place = (value) => {
    const tops = {};
    if (record(value.tops))
      for (const [id, top] of Object.entries(value.tops))
        if (offset(top)) tops[id] = offset(top);
    return { page: value.page, top: offset(value.top), tops };
  };
  if (!record(saved)) return { tab: "current", past: null, places };
  if (record(saved.places))
    for (const [round, value] of Object.entries(saved.places))
      if (record(value) && typeof value.page === "string")
        places[round] = place(value);
  return {
    tab: saved.tab === "past" ? "past" : "current",
    past: typeof saved.past === "string" ? saved.past : null,
    places,
  };
}
// A remembered page that the round no longer has is ignored.
export function placeFor(places, round, pageIds) {
  const place = places[round];
  return place && pageIds.includes(place.page) ? place : null;
}

// Drafts are keyed by session and name, not round. When a new round
// lands, items that were already sent are dropped and unsent items carry over.
export function loadDraft(saved, round) {
  if (!record(saved) || !Array.isArray(saved.notes) || !record(saved.choices))
    return emptyDraft(round);
  const draft = {
    ...emptyDraft(round),
    ...saved,
    alignUnflagged:
      typeof saved.alignUnflagged === "boolean" ? saved.alignUnflagged : true,
    answers: record(saved.answers) ? saved.answers : {},
    noteDrafts: record(saved.noteDrafts) ? saved.noteDrafts : {},
  };
  if (saved.round !== round) {
    draft.notes = draft.notes.filter((note) => !note.sentIn);
    draft.choices = filterValues(draft.choices, (choice) => !choice.sentIn);
    draft.answers = filterValues(draft.answers, (answer) => !answer.sentIn);
    draft.submitted = null;
    draft.pending = null;
    draft.acceptance = null;
    draft.acceptGuidance = "";
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

// An acceptance sends the drafted items too, so none of them carries over
// to the next round's draft.
export function markItemsSent(draft, id) {
  for (const note of draft.notes) note.sentIn ||= id;
  for (const choice of Object.values(draft.choices)) choice.sentIn ||= id;
  for (const answer of Object.values(draft.answers)) answer.sentIn ||= id;
}

export function markSent(draft, id, at) {
  const { count } = unsentItems(draft);
  markItemsSent(draft, id);
  draft.submitted = { id, at, round: draft.round, count };
  draft.pending = null;
  return draft;
}
