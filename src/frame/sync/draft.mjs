import {
  draftChanges,
  mergeDraft,
  recordPushed,
} from "#frame/app/draft-merge.mjs";
import {
  changedPages,
  persist,
  setState,
  state,
  storedDraft,
} from "#frame/app/store.mjs";
import { base, editable, storageKey, views } from "#frame/app/view.mjs";
import { refreshReplies } from "#frame/notes/thread-reply.mjs";
import { showChanges } from "#frame/pages/pages.mjs";
import { submissionInFlight } from "#frame/review/send.mjs";
import { connected, remote, selectedTab } from "#frame/sync/rounds.mjs";

/* The hub keeps the items of the reviewer's draft that the reviewer
   completed, so a phone and a computer show the same notes, choices and
   answers. The frame also saves the whole draft in localStorage, and uses
   that copy alone when the hub is unreachable or keeps no draft. */

let hub = null;
let pushing = false;
let again = false;
let timer = null;
let refused = null;

// An older hub sends no draftId. The frame syncs only Current's draft, the
// one persist() saves, and not while a send is under way, because markSent()
// must mark the items that the send included.
const syncing = () =>
  editable &&
  connected &&
  typeof remote?.draftId === "string" &&
  selectedTab === "current" &&
  !submissionInFlight;

// keep holds the newest copy of the hub's draft that this tab has received.
function keep(next) {
  if (typeof next?.id !== "string" || !Number.isInteger(next.revision)) return;
  if (hub?.id === next.id && next.revision < hub.revision) return;
  hub = next;
}
// merge saves the draft only when the merge changed it, so a tab that has
// nothing new to merge never writes the copy that the other tabs load.
function merge(before = JSON.stringify(state.synced)) {
  if (!syncing() || hub?.id !== remote.draftId) return;
  const pages = mergeDraft(state, hub);
  if (!pages && JSON.stringify(state.synced) === before) return;
  persist();
  if (pages) showChanges(pages);
}
export function queuePush() {
  if (!syncing()) return;
  clearTimeout(timer);
  timer = setTimeout(push, 400);
}
async function push() {
  if (!syncing()) return;
  if (pushing) {
    again = true;
    return;
  }
  const changes = draftChanges(state);
  const body = JSON.stringify({ changes });
  if (!Object.keys(changes).length || body === refused) return;
  pushing = true;
  try {
    const response = await fetch(`${base}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    // A refused change stays in this browser's draft, and push sends it
    // again only after the reviewer changes the draft.
    if (response.status >= 400 && response.status < 500) refused = body;
    if (response.ok) {
      const answer = await response.json();
      const before = JSON.stringify(state.synced);
      recordPushed(state, JSON.parse(body).changes, answer);
      keep(answer);
      merge(before);
    }
  } catch {
    /* The change stays in this browser's draft, and syncDraft sends it
       after the next status the hub answers. */
  } finally {
    pushing = false;
    if (again) {
      again = false;
      queuePush();
    }
  }
}
// The frame calls syncDraft after each poll() of the hub's status, so a
// change the reviewer made while the hub was unreachable reaches the hub
// after the next status the hub answers. syncDraft merges whenever the draft
// is behind the status, because another tab can save an older merge over
// this tab's newer one.
export async function syncDraft() {
  if (!syncing()) return;
  const behind =
    remote.draftId !== state.synced.id ||
    remote.draftRevision > state.synced.revision;
  const held =
    hub?.id === remote.draftId && hub.revision >= remote.draftRevision;
  try {
    if (behind && !held && !pushing) {
      const response = await fetch(`${base}/api/draft`);
      if (response.ok) keep(await response.json());
    }
  } catch {
    /* The next poll reads the draft again. */
  }
  merge();
  await push();
}
// Every tab of a session saves its draft under one key. When another tab
// saves the draft for the round on screen here, this tab loads that draft,
// so it never saves its older copy back, such as a copy from before a send.
// The handler saves nothing itself, because each save starts this handler in
// the other tabs.
export function installDraftSync() {
  if (!editable) return;
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    const past = selectedTab === "past";
    const view = past ? views.get(remote?.current?.round) : null;
    const held = past ? view?.draft : state;
    const draft = held && storedDraft(event.newValue, held.round);
    if (!draft) return;
    if (past) {
      view.draft = draft;
      return;
    }
    const before = state;
    setState(draft);
    showChanges(changedPages(before, draft));
    refreshReplies();
  });
}
