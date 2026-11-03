import { $ } from "#frame/app/util.mjs";
import { embedded, mode } from "#frame/app/view.mjs";

/* On a computer, the note, Send, Start, New work item and Keys open in a drawer
   beside what the reviewer clicked, and the page behind it stays in use. On a
   phone or a tablet they open as modals, as they do in the search window's
   frame and in a preview. drawer.css uses the same media rule. */
const TOUCH = "(max-width: 720px), (pointer: coarse)";
const asModal = () =>
  embedded || mode === "preview" || matchMedia(TOUCH).matches;
// The space a drawer keeps from the header's line and the window's bottom, as
// --dialog-margin.
const MARGIN = 10;
// A drawer over the end of a tall selection leaves its first line in view, and
// keeps at least LEAST_PX of height.
const FIRST_LINE_PX = 28;
const LEAST_PX = 240;

const shown = (element) => element?.isConnected && element.checkVisibility();
/* A spot is what a drawer opens beside. rect() returns its box, with the left
   of its first and last lines, or null once it is gone from the screen. A
   spot at the end lines the drawer up with its right edge. */
export function besideElement(element, { end = false, gap = 8 } = {}) {
  return {
    end,
    gap,
    // A button in the header opens its drawer just under it.
    header: Boolean(element?.closest(".frame-header")),
    rect() {
      if (!shown(element)) return null;
      const box = element.getBoundingClientRect();
      return { ...box.toJSON(), firstLeft: box.left, lastLeft: box.left };
    },
  };
}
export const besideControl = (element) =>
  besideElement(element, { end: true, gap: 6 });
export function besideText(range) {
  return {
    end: false,
    gap: 8,
    rect() {
      const lines = [...range.getClientRects()].filter((box) => box.width > 1);
      if (!lines.length || !shown(range.startContainer.parentElement))
        return null;
      const box = range.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        right: box.right,
        firstLeft: lines[0].left,
        lastLeft: lines.at(-1).left,
      };
    },
  };
}
// Keys has no button, so it opens under the header at the right.
export const underHeader = () => ({
  end: true,
  gap: 6,
  header: true,
  rect() {
    const header = document
      .querySelector(".frame-header")
      .getBoundingClientRect();
    const right = header.right - 16;
    return { top: header.top, bottom: header.bottom - 10, right };
  },
});
// The control the reviewer pressed last, for a note that has no words or block
// on screen to open beside. A key opens nothing beside a control, so a key
// press forgets it.
let pressed = null;
export const pressedControl = () =>
  pressed && performance.now() - pressed.at < 1000 ? pressed.control : null;

/* The drawer goes below its spot, or above it when there is no room below.
   With room on neither side, it goes over the end of words or a block and
   leaves their first line in view. It stays in the frame's column and above the
   window's bottom. Scrolling and a resize place it again on the same side, so
   it moves with its words. */
let placed = null;
function place(dialog, spot, side) {
  const rect = spot.rect();
  if (!rect) return;
  const header = document
    .querySelector(".frame-header")
    .getBoundingClientRect();
  const frame = $("content").getBoundingClientRect();
  const view = window.visualViewport;
  const floor =
    Math.min(innerHeight, view ? view.offsetTop + view.height : innerHeight) -
    MARGIN;
  const ceiling = spot.header ? rect.bottom + spot.gap : header.bottom + MARGIN;
  const body = dialog.querySelector(".dialog-body");
  const height =
    dialog.offsetHeight + (body ? body.scrollHeight - body.clientHeight : 0);
  const width = dialog.offsetWidth;
  const below = floor - rect.bottom - spot.gap;
  const above = rect.top - spot.gap - ceiling;
  // A button stays in view, so with room on neither side its drawer takes the
  // larger side and its form scrolls.
  side ??=
    height <= below
      ? "below"
      : height <= above
        ? "above"
        : spot.end
          ? below >= above
            ? "below"
            : "above"
          : "over";
  const least = Math.min(height, LEAST_PX);
  const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
  const style = dialog.style;
  if (side === "above") {
    const edge = clamp(rect.top - spot.gap, ceiling + least, floor);
    style.top = "auto";
    style.bottom = `${innerHeight - edge}px`;
    style.maxHeight = `${edge - ceiling}px`;
  } else {
    const top =
      side === "below"
        ? clamp(rect.bottom + spot.gap, ceiling, floor - least)
        : clamp(
            Math.max(floor - height, rect.top + FIRST_LINE_PX),
            ceiling,
            floor - least,
          );
    style.bottom = "auto";
    style.top = `${top}px`;
    style.maxHeight = `${floor - top}px`;
  }
  // A spot at the end, a button, keeps the drawer inside the frame. Words and
  // blocks keep it inside the column the text is in.
  const padding = spot.end
    ? MARGIN
    : parseFloat(getComputedStyle($("content")).paddingLeft);
  const low = frame.left + padding;
  const high = frame.right - padding - width;
  const want = spot.end
    ? rect.right - width
    : side === "below"
      ? rect.lastLeft
      : rect.firstLeft;
  style.left = `${clamp(want, low, Math.max(low, high))}px`;
  placed = { dialog, spot, side };
}
function placeAgain() {
  if (placed?.dialog.open && !placed.dialog.matches(":modal"))
    place(placed.dialog, placed.spot, placed.side);
}

/* Only one drawer is open at a time, so a drawer that opens replaces the open
   one in place. The swap has no motion, so the two never show together. A
   drawer that is already open moves to its new spot. */
export function openDrawer(dialog, spot) {
  if (dialog.open) {
    if (spot && !dialog.matches(":modal")) place(dialog, spot);
    return;
  }
  const others = [
    ...document.querySelectorAll("dialog[data-drawer][open]"),
  ].filter((other) => !other.matches(":modal"));
  const swapped = [dialog, ...others];
  if (others.length)
    for (const item of swapped) item.classList.add("drawer-swap");
  for (const other of others) other.close();
  for (const name of ["top", "bottom", "left", "maxHeight"])
    dialog.style[name] = "";
  const modal = asModal();
  // The drawer is placed while it is still hidden, so it rises from its spot.
  if (!modal && spot) place(dialog, spot);
  if (modal) dialog.showModal();
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
   modal's box inside the part the keyboard leaves, and place() keeps a
   drawer's bottom above it. */
function follow() {
  if (!document.querySelector("dialog[data-drawer][open]")) return;
  placeAgain();
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
  addEventListener("resize", placeAgain);
  document.querySelector("main")?.addEventListener("scroll", placeAgain, {
    passive: true,
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      const control = event.target.closest?.("button, a");
      pressed = control ? { control, at: performance.now() } : null;
    },
    true,
  );
  document.addEventListener("keydown", () => (pressed = null), true);
  for (const body of document.querySelectorAll(".dialog .dialog-body"))
    if (body.closest("dialog").querySelector(".actions, .note-actions"))
      watchScroll(body);
}
