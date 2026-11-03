import { $ } from "#frame/app/util.mjs";
import { embedded, mode, page } from "#frame/app/view.mjs";
import { findQuote, noteContext } from "#frame/notes/notes.mjs";

/* On a computer, the note, Send, Start, New work item and Keys open in a drawer
   at the bottom left of the frame, and the page behind it stays in use. On a
   phone the note opens in a sheet above the keyboard and the others open as
   modals. The search window's frame and a preview open them as modals. */
const PHONE = "(max-width: 720px)";
// A phone's keyboard takes more height than this, as in search/modal.mjs.
const KEYBOARD_PX = 120;
// With a hardware keyboard the phone reports no keyboard, so the sheet shows
// after this wait.
const SETTLE_MS = 350;
// The space between the words a note is on and the sheet above the keyboard.
const CLEARANCE_PX = 12;

const narrow = () => matchMedia(PHONE).matches;
const asModal = (dialog) =>
  embedded || mode === "preview" || (narrow() && dialog.id !== "note-dialog");

/* Only one drawer is open at a time, so a drawer that opens replaces the open
   one in place. The swap has no motion, so the two never show together. */
export function openDrawer(dialog) {
  if (dialog.open) return;
  const others = [
    ...document.querySelectorAll("dialog[data-drawer][open]"),
  ].filter((other) => !other.matches(":modal"));
  const swapped = [dialog, ...others];
  if (others.length)
    for (const item of swapped) item.classList.add("drawer-swap");
  for (const other of others) other.close();
  if (asModal(dialog)) dialog.showModal();
  else dialog.show();
  // WebKit's show() leaves focus where it was.
  if (!dialog.contains(document.activeElement))
    dialog.querySelector("[autofocus]")?.focus();
  follow();
  if (dialog.id === "note-dialog") openSheet(dialog);
  if (others.length)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const item of swapped) item.classList.remove("drawer-swap");
      }),
    );
}

/* The sheet stays at opacity 0 while the box takes focus, so a phone's keyboard
   rises first. data-settled shows the sheet once the keyboard has risen. A
   drawer is settled from the start, so it shows as a sheet if the window
   narrows. */
let tallest = 0;
let settleTimer = 0;
let keyboardSeen = false;
let lifted = null;
function openSheet(sheet) {
  clearTimeout(settleTimer);
  if (!narrow() || sheet.matches(":modal")) {
    sheet.dataset.settled = "";
    return;
  }
  delete sheet.dataset.settled;
  keyboardSeen = false;
  tallest = window.visualViewport?.height ?? innerHeight;
  follow();
  settleTimer = setTimeout(settle, SETTLE_MS);
}
const sheetOpen = () =>
  $("note-dialog").open && narrow() && !$("note-dialog").matches(":modal");
/* A touch keyboard shrinks only the visual viewport, on a tablet as on a phone,
   so the sheet and the drawer keep their bottom above it. */
function follow() {
  const open = document.querySelector("dialog[data-drawer][open]");
  if (!open || open.matches(":modal") || !window.visualViewport) return;
  const { height, offsetTop } = visualViewport;
  const root = document.documentElement.style;
  root.setProperty(
    "--keyboard-inset",
    `${Math.max(0, innerHeight - offsetTop - height)}px`,
  );
  root.setProperty("--vv-height", `${height}px`);
  if (!sheetOpen()) return;
  if (!keyboardSeen && tallest - height > KEYBOARD_PX) {
    keyboardSeen = true;
    settle();
  }
}
function settle() {
  clearTimeout(settleTimer);
  if (!sheetOpen()) return;
  $("note-dialog").dataset.settled = "";
  liftPage();
}

/* The page moves up only when the sheet would cover the words the note is on,
   and only as far as it must. It scrolls at once, and the column slides from
   where it was, so the words rise with the sheet. */
function slidePage(distance) {
  const body = document.querySelector(".app-body");
  const column = document.querySelector(".main-column");
  // The last lines of a page need room below them to rise above the sheet.
  const room = body.scrollHeight - body.clientHeight - body.scrollTop;
  if (distance > room)
    column.style.paddingBottom = `${Math.ceil(distance - room)}px`;
  const before = body.scrollTop;
  body.scrollTop = before + distance;
  const moved = body.scrollTop - before;
  if (!moved) return 0;
  const slide = parseFloat(
    getComputedStyle(column).getPropertyValue("--slide"),
  );
  column.animate(
    [{ transform: `translateY(${moved}px)` }, { transform: "none" }],
    { duration: (slide || 0) * 1000, easing: "ease" },
  );
  return moved;
}
function liftPage() {
  const note = noteContext;
  if (!note?.quote || note.topic !== page?.id || $("reading").hidden) return;
  const range = findQuote(note.quote, note.target, note.occurrence);
  if (!range) return;
  const { height, offsetTop } = window.visualViewport ?? {
    height: innerHeight,
    offsetTop: 0,
  };
  const sheetTop = offsetTop + height - $("note-dialog").offsetHeight;
  const distance = Math.ceil(
    range.getBoundingClientRect().bottom - sheetTop + CLEARANCE_PX,
  );
  if (distance <= 0) return;
  const moved = slidePage(distance);
  if (!moved) return;
  const top = document.querySelector(".app-body").scrollTop;
  lifted = { moved: (lifted?.moved ?? 0) + moved, top };
}
// The page goes back when the sheet closes, unless the reviewer scrolled it.
function lowerPage() {
  const was = lifted;
  lifted = null;
  if (!was) return;
  const body = document.querySelector(".app-body");
  if (Math.abs(body.scrollTop - was.top) < 1) slidePage(-was.moved);
  document.querySelector(".main-column").style.paddingBottom = "";
}

/* Where a form scrolls with its buttons fixed below it, a line separates the
   two while some of the form is below what shows. */
function watchScroll(body) {
  const dialog = body.closest("dialog");
  const mark = () =>
    dialog.toggleAttribute(
      "data-more-below",
      body.scrollHeight - body.clientHeight - body.scrollTop > 1,
    );
  body.addEventListener("scroll", mark, { passive: true });
  const watch = new ResizeObserver(mark);
  watch.observe(body);
  for (const child of body.children) watch.observe(child);
}

export function installDrawer() {
  window.visualViewport?.addEventListener("resize", follow);
  window.visualViewport?.addEventListener("scroll", follow);
  $("note-dialog").addEventListener("close", () => {
    if ($("note-dialog").open) return;
    clearTimeout(settleTimer);
    delete $("note-dialog").dataset.settled;
    lowerPage();
  });
  for (const body of document.querySelectorAll(".dialog .dialog-body"))
    if (body.closest("dialog").querySelector(".actions, .note-actions"))
      watchScroll(body);
}
