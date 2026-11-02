import { state } from "#frame/app/store.mjs";
import { embedded, session } from "#frame/app/view.mjs";
import { fieldHasFocus, inUse } from "#frame/pages/pages.mjs";
import { selectedTab } from "#frame/sync/rounds.mjs";

/* A tab keeps the frame code it loaded, and that code can show a broken page
   against a hub that restarted on new code. So the tab reloads once a session's
   status reports a version other than the one the hub served the page with. A
   hub answers a session's status only after it has loaded that session, so the
   reload finds its page, and a hub that is down reports nothing.

   The search window's frame never reloads itself, because the search window
   would lose its result. The tab reloads after the search window closes, and
   that replaces the frame too. */
const TRIED = "pair:reloaded-for";
// The frame saves an answer 300ms after the last key, and a drawing 300ms after
// its last change, which the dialog's close saves at once.
const QUIET_MS = 1000;
let writes = 0;
let usedAt = 0;

// A reload would cancel a request under way, such as a reply or an image upload.
export function installHubWatch() {
  if (embedded) return;
  const send = window.fetch;
  window.fetch = (input, options) => {
    if (!options?.method || options.method === "GET")
      return send(input, options);
    writes++;
    return send(input, options).finally(() => writes--);
  };
  for (const type of ["input", "close"])
    addEventListener(type, () => (usedAt = Date.now()), true);
}
// The frame saves a draft only on Current, so a reply typed on an older round
// exists only in this tab, and so does every draft when saving failed.
const onlyInMemory = () =>
  (selectedTab !== "current" &&
    (Object.keys(state?.replyDrafts ?? {}).length > 0 ||
      Boolean(state?.itemDraft))) ||
  Boolean(document.getElementById("storage-status")?.textContent);
// A phone can report hasFocus() false while the keyboard is up, so a focused
// field counts here whether the window has focus or not.
const readerBusy = () =>
  writes > 0 ||
  Date.now() - usedAt < QUIET_MS ||
  inUse() ||
  fieldHasFocus() ||
  Boolean(document.querySelector(":active, :popover-open")) ||
  getSelection()?.isCollapsed === false ||
  onlyInMemory();
/* The frame calls noticeHub after each status, so a reload that waited comes
   after the first status once the reader has finished. Each version gets one
   try, so a page that still differs after its reload, such as while a hub is
   restarting, stays as it is. Where the tab can't record the try, it never
   reloads. */
export function noticeHub(version) {
  if (
    embedded ||
    !version ||
    !session.hubVersion ||
    version === session.hubVersion ||
    readerBusy()
  )
    return;
  try {
    if (sessionStorage.getItem(TRIED) === version) return;
    sessionStorage.setItem(TRIED, version);
  } catch {
    return;
  }
  location.reload();
}
