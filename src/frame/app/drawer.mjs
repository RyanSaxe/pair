import { $ } from "#frame/app/util.mjs";
import { embedded, mode } from "#frame/app/view.mjs";

/* On a computer, the note, Send, Start, New work item and Keys open in a drawer
   at the bottom left of the frame, and the page behind it stays in use. On a
   phone or a tablet they open as modals, as they do in the search window's
   frame and in a preview. drawer.css uses the same media rule. */
const TOUCH = "(max-width: 720px), (pointer: coarse)";
const asModal = () =>
  embedded || mode === "preview" || matchMedia(TOUCH).matches;

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
  if (asModal()) dialog.showModal();
  else dialog.show();
  // WebKit's show() leaves focus where it was.
  if (!dialog.contains(document.activeElement))
    dialog.querySelector("[autofocus]")?.focus();
  follow();
  if (others.length)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const item of swapped) item.classList.remove("drawer-swap");
      }),
    );
}

/* A touch keyboard shrinks only the visual viewport, so drawer.css keeps a
   drawer's bottom, and a modal's box, inside the part the keyboard leaves. */
function follow() {
  if (!document.querySelector("dialog[data-drawer][open]")) return;
  if (!window.visualViewport) return;
  const { height, offsetTop } = visualViewport;
  const root = document.documentElement.style;
  root.setProperty(
    "--keyboard-inset",
    `${Math.max(0, innerHeight - offsetTop - height)}px`,
  );
  root.setProperty("--vv-top", `${offsetTop}px`);
  root.setProperty("--vv-height", `${height}px`);
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
  for (const body of document.querySelectorAll(".dialog .dialog-body"))
    if (body.closest("dialog").querySelector(".actions, .note-actions"))
      watchScroll(body);
}
