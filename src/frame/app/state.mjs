export let state;
export function setState(draft) {
  state = draft;
}

export let selectedTab = "current";
export function setSelectedTab(tab) {
  selectedTab = tab;
}

// listedTab is the tab whose round the sidebar lists. A tab click lists that
// round's pages but leaves the page on screen, with its own round's draft
// and threads, until the reader picks a page from the list.
export let listedTab = "current";
export function setListedTab(tab) {
  listedTab = tab;
}

// sentByRound contains the submission of each past round that the Previous
// tab has shown.
export const sentByRound = new Map();
export const pageSets = new Map();

export let remote = null;
export function setRemote(status) {
  remote = status;
}

// connected is null until the first status poll answers or fails.
export let connected = null;
export function setConnected(value) {
  connected = value;
}

export let lastSubmission = null;
export function setLastSubmission(submission) {
  lastSubmission = submission;
}

export let displayedRound;
export function setDisplayedRound(round) {
  displayedRound = round;
}

export let submissionError = "";
export function setSubmissionError(value) {
  submissionError = value;
}

export let submissionInFlight = false;
export function setSubmissionInFlight(value) {
  submissionInFlight = value;
}

// refusedMessage is the typed message of a send that the hub refused because
// the round already has feedback.
export let refusedMessage = "";
export function setRefusedMessage(value) {
  refusedMessage = value;
}

export function clearSubmissionError() {
  submissionError = "";
  refusedMessage = "";
}

export let editing = null;
export function setEditing(value) {
  editing = value;
}

export let noteContext = null;
export function setNoteContext(value) {
  noteContext = value;
}

export let noteDraftKey = "";
export function setNoteDraftKey(value) {
  noteDraftKey = value;
}

export const progressThread = {
  topic: "agreed",
  anchor: "Progress",
  target: "agent-activity",
};

export function pageStatus(item) {
  if (item.status === "ready" || (!item.status && !item.pending)) {
    return "complete";
  }
  if (item.status === "active") return "active";
  return "queued";
}
