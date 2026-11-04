export const PHONE = 720;
// A phone's keyboard takes more height than this. The bar a phone shows over a
// hardware keyboard and a collapsing address bar take less.
const KEYBOARD_PX = 120;
// Longer than a keyboard takes to drop.
const DROP_REST_MS = 1000;

/* iOS keeps 100dvh when the keyboard opens, so the modal follows the visual
   viewport to stop the last results sitting under the keyboard. A keyboard
   shortens the visual viewport or the whole window, and a focused field may have
   a hardware keyboard or one that has dropped, so a keyboard is up when the height
   is well below the tallest since the modal opened. A pinch shrinks the height by
   its scale. A rotation changes the width and a keyboard doesn't.

   The results fill the window for the search field's keyboard, and until that
   keyboard has dropped, because a tap on a row blurs the field first. The preview
   fills the window while a field in it has focus, so a note has room before the
   keyboard rises, and the modal follows the pan iOS makes to reach that field. */
export function fitToPhone({ dialog, input, list, writing }) {
  let tallest = 0;
  let tallestWidth = 0;
  let revealOnDrop = false;
  function fit() {
    if (!window.visualViewport) return;
    const { height, offsetTop, scale } = visualViewport;
    const visible = height * scale;
    if (innerWidth !== tallestWidth) {
      tallest = innerHeight;
      tallestWidth = innerWidth;
    }
    tallest = Math.max(tallest, visible);
    dialog.style.setProperty("--search-height", `${height}px`);
    dialog.style.setProperty("--search-top", `${offsetTop}px`);
    const inFrame = innerWidth <= PHONE && writing();
    const typing =
      tallest - visible > KEYBOARD_PX &&
      !inFrame &&
      (dialog.classList.contains("is-typing") ||
        document.activeElement === input);
    dialog.classList.toggle("is-writing", inFrame);
    dialog.classList.toggle("is-typing", typing);
    if (typing) return;
    if (revealOnDrop)
      list
        .querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
    revealOnDrop = false;
  }
  visualViewport?.addEventListener("resize", fit);
  visualViewport?.addEventListener("scroll", fit);
  // Moving between fields leaves the keyboard up, so the viewport doesn't resize.
  input.addEventListener("focus", fit);
  // A window that a person shrank has no keyboard to drop, so its height after the
  // field has lost focus is the height with no keyboard.
  input.addEventListener("blur", () =>
    setTimeout(() => {
      if (!window.visualViewport || document.activeElement === input) return;
      tallest = visualViewport.height * visualViewport.scale;
      fit();
    }, DROP_REST_MS),
  );
  fit();
  return {
    fit,
    opened() {
      tallestWidth = 0;
      fit();
    },
    revealOnDrop(reveal) {
      revealOnDrop = reveal;
    },
  };
}
