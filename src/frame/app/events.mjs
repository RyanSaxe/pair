import { save, state } from "#frame/app/store.mjs";
import { $, controlKey } from "#frame/app/util.mjs";
import {
  editable,
  feedbackEditable,
  mode,
  page,
  pages,
  plan,
  session,
} from "#frame/app/view.mjs";
import {
  blockSkip,
  chooseBlock,
  chosen,
  commentOnTarget,
} from "#frame/notes/blocks.mjs";
import { restoreChoices } from "#frame/notes/controls.mjs";
import { settleNoteImages } from "#frame/notes/note-dialog.mjs";
import { openNote } from "#frame/notes/notes.mjs";
import { show } from "#frame/pages/pages.mjs";
import { closeMenus, toggleRoundMenu } from "#frame/sync/rounds-dialog.mjs";
import { switchTab } from "#frame/sync/rounds.mjs";
import { sessionOrder, toggleSidecar } from "#frame/sync/sessions.mjs";

export function installEvents() {
  for (const head of document.querySelectorAll("dialog .dialog-head")) {
    const close = $("close-button").content.firstElementChild.cloneNode(true);
    close.dataset.close = head.closest("dialog").id;
    if (head.dataset.closeLabel)
      close.setAttribute("aria-label", head.dataset.closeLabel);
    head.append(close);
  }
  // A click inside an embedded frame never reaches this document, but it does
  // move focus, so menus close on blur as well as on outside clicks.
  window.addEventListener("blur", closeMenus);
  document.addEventListener("click", (event) => {
    const close = event.target.closest("[data-close]");
    if (close) {
      if (close.dataset.close === "note-dialog") settleNoteImages();
      $(close.dataset.close).close();
    }
    const tab = event.target.closest("button[data-tab]");
    if (tab) {
      switchTab(tab.dataset.tab, null, { showPage: false });
      return;
    }
    const navigation = event.target.closest("[data-page]");
    if (navigation) {
      event.preventDefault();
      show(navigation.dataset.page);
    }
    if (event.target.closest("#round")) {
      toggleRoundMenu();
      return;
    }
    if (event.target.closest("#bell")) {
      toggleSidecar();
      return;
    }
    if (!feedbackEditable()) return;
    const comment = event.target.closest("[data-comment]");
    if (comment && $("page-content").contains(comment))
      openNote(
        page.id,
        comment.dataset.comment || page.title,
        "",
        null,
        null,
        comment.closest("[id]")?.id || null,
      );
    const choice = event.target.closest("[data-choice] [data-value]");
    if (choice && $("page-content").contains(choice)) {
      const group = choice.closest("[data-choice]"),
        id = controlKey(page.id, group.dataset.choice);
      if (state.choices[id]?.value === choice.dataset.value)
        delete state.choices[id];
      else
        state.choices[id] = {
          topic: page.id,
          label: group.dataset.label || group.dataset.choice,
          value: choice.dataset.value,
          valueLabel:
            choice.dataset.label ||
            choice.textContent.trim() ||
            choice.dataset.value,
          target: group.id,
          round: plan.round,
        };
      restoreChoices();
      save();
    }
  });
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        dialog.close();
    });
  }
  /* Keys */
  document.addEventListener("keydown", (event) => {
    /* Textareas keep Enter for newlines. Shift+Enter is the explicit submit
       gesture for the two text actions a reviewer otherwise has to click. */
    if (
      event.key === "Enter" &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      feedbackEditable()
    ) {
      const area = event.target.closest("textarea");
      const answer = area
        ?.closest("[data-question]")
        ?.querySelector("[data-answer]");
      if (answer && !answer.disabled) {
        event.preventDefault();
        answer.click();
        return;
      }
      if (area === $("note-text") && area.value.trim()) {
        event.preventDefault();
        $("note-form").requestSubmit();
        return;
      }
    }
    if (mode === "preview" || event.metaKey || event.ctrlKey || event.altKey)
      return;
    if (event.key === "Escape") {
      closeMenus();
      return;
    }
    if (event.target.closest("input, textarea, select, [contenteditable]"))
      return;
    if (document.querySelector("dialog[open]")) return;
    const key = event.key;
    if (key === "?") $("keys-dialog").showModal();
    else if (/^[1-9]$/.test(key)) {
      const entry = sessionOrder[Number(key) - 1];
      if (entry && entry.id !== session.sessionId) location.assign(entry.url);
    } else if (key === "]" || key === "[") {
      const order = pages.map((item) => item.id);
      const index = order.indexOf($("feedback").hidden ? page.id : "feedback");
      const next = order[index + (key === "]" ? 1 : -1)];
      if (next) show(next);
    } else if (key === "j" || key === "k") {
      /* The same blocks a click can choose, so the keys reach the comment
         control's target. Tab still steps through the controls inside one. */
      const blocks = [...$("page-content").children].filter(
        (block) => !blockSkip.has(block.tagName) && block.offsetParent,
      );
      if (!blocks.length) return;
      const index = blocks.indexOf(chosen);
      const next =
        blocks[
          index < 0
            ? key === "j"
              ? 0
              : blocks.length - 1
            : (index + (key === "j" ? 1 : -1) + blocks.length) % blocks.length
        ];
      // chooseBlock toggles, so landing on the current block would clear it.
      if (next !== chosen) chooseBlock(next);
      next.tabIndex = -1;
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "center" });
    } else if (key === "c" && feedbackEditable() && !$("reading").hidden)
      commentOnTarget();
    else if (key === "r" && editable) show("feedback");
    else if (key === "s" && editable) {
      if ($("submit").disabled) return;
      $("submit").focus();
    } else if (key === "a") show("agreed");
    else return;
    event.preventDefault();
  });
}
