import {
  draftChanges,
  mergeDraft,
  recordPushed,
} from "#frame/app/draft-merge.mjs";
import { persist, state } from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import { base, editable, page, storageKey } from "#frame/app/view.mjs";
import { refreshReplies } from "#frame/notes/thread-reply.mjs";
import { show } from "#frame/pages/pages.mjs";
import { refreshWork } from "#frame/pages/work.mjs";
import { review } from "#frame/review/review.mjs";
import { submissionInFlight } from "#frame/review/send.mjs";
import { connected, remote, selectedTab } from "#frame/sync/rounds.mjs";

/* The hub keeps the reviewer's unsent draft, so a phone and a computer
   show the same notes, choices and answers. The frame also saves this
   browser's copy in localStorage, and uses that copy alone when the hub is
   unreachable or is a version that keeps no draft. */

let hub = null;
let merged = true;
let pushing = false;
let again = false;
let timer = null;
let refused = null;

// An older hub sends no draftRevision. The frame syncs only Current's draft,
// the one persist() saves, and not while a send is under way, because
// markSent() must mark the items that the send included.
const syncing = () =>
  editable &&
  connected &&
  remote?.draftRevision !== undefined &&
  selectedTab === "current" &&
  !submissionInFlight;
const dialogs = ["note-dialog", "drawing-dialog", "send-dialog"];
const typing = () =>
  dialogs.some((id) => $(id)?.open) ||
  Boolean(
    document.activeElement?.matches?.(
      "textarea, input:is([type=text], [type=search], :not([type]))",
    ),
  );

// keep ignores a draft older than one the frame has already seen, such as a
// response to a read that started before a send.
function keep(next) {
  if (!next || !Number.isInteger(next.revision)) return;
  if (hub && next.revision < hub.revision) return;
  if (next.revision < (remote?.draftRevision ?? 0)) return;
  if (hub?.revision !== next.revision) merged = false;
  hub = next;
}
// applyHub waits while the reviewer types in a field or has a dialog open,
// and the frame calls it again when the field loses focus or the dialog
// closes, so the reviewer's typing is never replaced mid-word.
export function applyHub() {
  if (!hub || merged || !syncing()) return;
  const hold = typing();
  const before = JSON.stringify(state.synced);
  const changed = mergeDraft(state, hub, { hold });
  merged = !hold;
  if (!changed && JSON.stringify(state.synced) === before) return;
  persist();
  if (!changed) return;
  if (!$("reading").hidden)
    show(page.id, null, { keepScroll: true, push: false, inPlace: true });
  refreshReplies();
  refreshWork();
  review();
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
      if (Number.isInteger(answer?.revision) && answer.items)
        recordPushed(state, JSON.parse(body).changes, answer);
      keep(answer);
      applyHub();
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
// after the next status the hub answers.
export async function syncDraft() {
  if (!syncing()) return;
  try {
    if ((hub?.revision ?? -1) < remote.draftRevision && !pushing) {
      const response = await fetch(`${base}/api/draft`);
      if (response.ok) keep(await response.json());
    }
  } catch {
    /* The next poll reads the draft again. */
  }
  applyHub();
  await push();
}
export function installDraftHub() {
  if (!editable) return;
  const later = () => setTimeout(applyHub, 0);
  document.addEventListener("focusout", later);
  for (const id of dialogs) $(id)?.addEventListener("close", later);
  // installDraftSync() adds its storage handler first, so this handler
  // merges the hub's draft again into the draft that another tab saved.
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    merged = false;
    applyHub();
  });
}
