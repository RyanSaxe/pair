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
// A text box's first line, with the box's padding.
const CARET_PX = 40;
const LEAST_PX = 240;

const shown = (element) => element?.isConnected && element.checkVisibility();
/* A spot is what a drawer opens beside. rect() returns its box, with the left
   of its first and last lines, or null once it is gone from the screen. A
   spot at the end lines the drawer up with its right edge. */
function besideElement(element, { end = false, gap = 8 } = {}) {
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
const besideControl = (element) =>
  besideElement(element, { end: true, gap: 6 });
function besideText(range) {
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
const underHeader = () => ({
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
/* The control that opened the drawer: the last one pressed with the pointer,
   or with Enter or Space. Any other key forgets it, because a key such as c
   opens nothing beside a control. */
let pressed = null;
function pressedControl() {
  const control =
    pressed && performance.now() - pressed.at < 1000 ? pressed.control : null;
  return shown(control) && !control.closest("dialog") ? control : null;
}
function press(control) {
  pressed = control ? { control, at: performance.now() } : null;
}

/* Every drawer opens beside what it came from, by one rule: beside the words a
   note is on, else beside the button that opened it, else beside the block or
   card the note is on, else beside its home. The comment button floats over
   the page, so a note it opens on a block goes beside the block. Keys has no
   button, so its home is "header", under the header at the right. */
function spotFor({ words, block, home }) {
  if (words) return besideText(words);
  const control = pressedControl();
  if (control && !(block && control === $("comment-here")))
    return besideControl(control);
  if (shown(block)) return besideElement(block);
  return home === "header" ? underHeader() : besideControl(home);
}

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
   drawer that is already open moves to its new spot. about.field is the text
   box the drawer focuses, if any. */
export function openDrawer(dialog, about = {}) {
  let spot = spotFor(about);
  if (!spot.rect()) spot = underHeader();
  if (dialog.open) {
    if (!dialog.matches(":modal")) place(dialog, spot);
    about.field?.focus();
    return;
  }
  const others = [
    ...document.querySelectorAll("dialog[data-drawer][open]"),
  ].filter((other) => !other.matches(":modal"));
  const modal = asModal();
  // A modal opens where it stays, so it has no motion until it has shown.
  const swapped = others.length || modal ? [dialog, ...others] : [];
  holdStill(swapped);
  for (const other of others) other.close();
  for (const name of ["top", "bottom", "left", "maxHeight"])
    dialog.style[name] = "";
  // The drawer is placed while it is still hidden, so it rises from its spot.
  if (!modal) place(dialog, spot);
  // showModal can focus the field itself, so the modal has its place first.
  if (modal && about.field) expectKeyboard();
  keepAboveKeyboard();
  if (modal) dialog.showModal();
  else dialog.show();
  follow();
  // WebKit's show() leaves focus where it was. The field takes focus after the
  // modal has its place, because iOS finds where to pan when it does.
  if (about.field) about.field.focus();
  else if (!dialog.contains(document.activeElement))
    dialog.querySelector("[autofocus]")?.focus();
}
// The drawers show their next place with no motion.
function holdStill(drawers) {
  if (!drawers.length) return;
  for (const item of drawers) item.classList.add("drawer-swap");
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const item of drawers) item.classList.remove("drawer-swap");
    }),
  );
}

/* A touch keyboard shrinks only the visual viewport, so drawer.css keeps a
   modal's box inside the part the keyboard leaves, and place() keeps a
   drawer's bottom above it.

   The keyboard rises after a text box takes focus, and iOS pans the whole
   page to reach a box the keyboard would cover. So from the moment a modal's
   text box is about to take focus, the modal sits above the keyboard it
   expects: as tall as the last one in a window this wide, or a guess the
   first time. iOS then has nothing to pan, and once the keyboard has risen
   the modal moves only if the guess was wrong. */
const KEYBOARD_KEY = "pair:keyboard";
// Longer than a keyboard takes to rise, and the quiet after its last resize.
const RISE_MS = 1000;
const SETTLE_MS = 150;
// While a keyboard rises, the height it is expected to reach, else 0.
let rising = 0;
let settling = 0;
// Only a window with a touch screen raises a keyboard for a text box.
function expectKeyboard() {
  if (!matchMedia("(any-pointer: coarse)").matches) return false;
  rising = expected();
  clearTimeout(settling);
  settling = setTimeout(settle, RISE_MS);
  return true;
}
const textField = (element) =>
  element?.matches?.(
    "textarea, input:is([type=text], [type=search], [type=url], [type=email], :not([type]))",
  ) || Boolean(element?.isContentEditable);
const typing = () =>
  textField(document.activeElement) &&
  Boolean(document.activeElement.closest("dialog[data-drawer]:modal"));
function keyboards() {
  try {
    return JSON.parse(localStorage.getItem(KEYBOARD_KEY)) || {};
  } catch {
    /* When localStorage throws, every keyboard is a guess. */
    return {};
  }
}
// The first guess is about what an iPhone's or an iPad's keyboard covers of a
// window that is upright or on its side.
const expected = () =>
  keyboards()[innerWidth] ??
  Math.round(innerHeight * (innerHeight > innerWidth ? 0.4 : 0.6));
// The height of the keyboard over a modal's text box is the height the next
// modal expects, even when no keyboard rose.
function remember() {
  if (!typing() || !window.visualViewport) return;
  try {
    const known = keyboards();
    known[innerWidth] = Math.round(innerHeight - visualViewport.height);
    localStorage.setItem(KEYBOARD_KEY, JSON.stringify(known));
  } catch {
    /* When localStorage throws, the next keyboard is a guess. */
  }
}
function settle() {
  clearTimeout(settling);
  rising = 0;
  remember();
  follow();
}
function follow() {
  if (!document.querySelector("dialog[data-drawer][open]")) return;
  placeAgain();
  keepAboveKeyboard();
}
function keepAboveKeyboard() {
  if (!window.visualViewport) return;
  const { height, offsetTop } = visualViewport;
  const risen = Math.max(0, innerHeight - height);
  const keyboard = Math.max(risen, rising);
  const root = document.documentElement.style;
  root.setProperty(
    "--keyboard-inset",
    `${Math.max(0, keyboard - offsetTop)}px`,
  );
  root.setProperty("--vv-top", `${offsetTop}px`);
  root.setProperty("--vv-height", `${innerHeight - keyboard}px`);
}
function resized() {
  remember();
  if (typing()) {
    clearTimeout(settling);
    settling = setTimeout(settle, SETTLE_MS);
  }
  follow();
}
/* A tap on a text box in an open modal raises the keyboard too. iOS pans when
   the box's first line, where the caret is, would be under the keyboard once
   the page has laid out. So in that case the modal takes its new place at
   once, and otherwise it glides there. */
function focusIn(event) {
  if (!typing()) return;
  let covered = false;
  if (!textField(event.relatedTarget) && expectKeyboard()) {
    const box = event.target.getBoundingClientRect();
    covered =
      Math.min(box.bottom, box.top + CARET_PX) > innerHeight - rising - MARGIN;
  }
  if (covered) holdStill([event.target.closest("dialog")]);
  follow();
  if (covered) revealField("instant");
}
// The keyboard drops when focus leaves the text boxes.
function focusOut(event) {
  if (!textField(event.target) || textField(event.relatedTarget)) return;
  clearTimeout(settling);
  rising = 0;
  follow();
}

/* A modal that shrank above the keyboard can leave its text box below what its
   form shows, so the form scrolls to the box: at once when the modal jumped,
   and smoothly once a glide has ended. */
function revealField(behavior) {
  if (!typing()) return;
  const field = document.activeElement;
  const body = field.closest(".dialog-body");
  if (!body) return;
  const box = field.getBoundingClientRect();
  const view = body.getBoundingClientRect();
  const by =
    box.top < view.top
      ? box.top - view.top
      : Math.max(0, Math.min(box.bottom - view.bottom, box.top - view.top));
  if (by) body.scrollBy({ top: by, behavior });
}
function glided(event) {
  if (
    event.target === event.currentTarget &&
    event.propertyName === "max-height"
  )
    revealField("smooth");
}

/* Where a dialog's body scrolls under its title, a line separates the two while
   some of the body is above what shows. Where buttons sit below the body, a line
   separates them while some of it is below. */
function watchScroll(body) {
  const dialog = body.closest("dialog");
  const buttons = dialog.querySelector(".actions, .note-actions");
  const mark = () => {
    dialog.toggleAttribute("data-more-above", body.scrollTop > 1);
    dialog.toggleAttribute(
      "data-more-below",
      Boolean(buttons) &&
        body.scrollHeight - body.clientHeight - body.scrollTop > 1,
    );
  };
  body.addEventListener("scroll", mark, { passive: true });
  const watch = new ResizeObserver(mark);
  watch.observe(body);
  for (const child of body.children) watch.observe(child);
}

export function installDrawer() {
  window.visualViewport?.addEventListener("resize", resized);
  window.visualViewport?.addEventListener("scroll", follow);
  document.addEventListener("focusin", focusIn);
  document.addEventListener("focusout", focusOut);
  addEventListener("resize", placeAgain);
  document.querySelector("main")?.addEventListener("scroll", placeAgain, {
    passive: true,
  });
  const control = (event) => event.target.closest?.("button, a") ?? null;
  document.addEventListener(
    "pointerdown",
    (event) => press(control(event)),
    true,
  );
  document.addEventListener(
    "keydown",
    (event) =>
      press(event.key === "Enter" || event.key === " " ? control(event) : null),
    true,
  );
  for (const body of document.querySelectorAll(".dialog .dialog-body"))
    watchScroll(body);
  for (const dialog of document.querySelectorAll("dialog[data-drawer]"))
    dialog.addEventListener("transitionend", glided);
}
