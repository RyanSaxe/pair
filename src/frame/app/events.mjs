import { save, state } from "#frame/app/store.mjs";
import { land } from "#frame/app/places.mjs";
import { $, controlKey, shiftEnter } from "#frame/app/util.mjs";
import {
  editable,
  feedbackEditable,
  mode,
  page,
  pages,
  plan,
  session,
  shownPage,
} from "#frame/app/view.mjs";
import {
  chooseBlock,
  choosable,
  chosen,
  commentOnTarget,
} from "#frame/notes/blocks.mjs";
import { restoreChoices } from "#frame/notes/controls.mjs";
import { settleNoteImages } from "#frame/notes/note-dialog.mjs";
import { openNote } from "#frame/notes/notes.mjs";
import { pageOrder, show } from "#frame/pages/pages.mjs";
import { closeMenus } from "#frame/sync/rounds-panel.mjs";
import {
  listTab,
  listedTab,
  selectedTab,
  switchTab,
} from "#frame/sync/rounds.mjs";
import { toggleCenter } from "#frame/sync/center.mjs";
import {
  nextWaiting,
  numbered,
  sessionOrder,
  toggleSessions,
} from "#frame/sync/sessions.mjs";

/* The ×, Escape and a click outside each call backOut(). Backing out of the
   note dialog keeps its text as a draft, and settleNoteImages() drops the
   images uploaded from it. */
function backOut(dialog) {
  if (dialog.id === "note-dialog") settleNoteImages();
}
/* A click counts as outside only when the press and the release both land on
   the backdrop, so a drag that starts in the dialog, such as selecting a
   field's text, leaves the dialog open. The browser sets the target of a
   click on the backdrop to the dialog itself, at a point outside its box. */
function outside(dialog, event) {
  if (event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

export function installEvents() {
  for (const head of document.querySelectorAll(
    "dialog :is(.dialog-head, .drawing-head)",
  )) {
    const close = $("close-button").content.firstElementChild.cloneNode(true);
    close.dataset.close = head.closest("dialog").id;
    if (head.dataset.closeLabel)
      close.setAttribute("aria-label", head.dataset.closeLabel);
    head.append(close);
  }
  for (const dialog of document.querySelectorAll("dialog")) {
    let pressedOutside = false;
    dialog.addEventListener("pointerdown", (event) => {
      pressedOutside = outside(dialog, event);
    });
    dialog.addEventListener("click", (event) => {
      if (pressedOutside && outside(dialog, event)) {
        backOut(dialog);
        dialog.close();
      }
      pressedOutside = false;
    });
    // The browser closes the dialog on Escape once this event returns.
    dialog.addEventListener("cancel", () => backOut(dialog));
  }
  // A click inside an embedded frame never reaches this document, but it
  // moves focus, so the frame closes menus on blur as well as on outside
  // clicks.
  window.addEventListener("blur", closeMenus);
  document.addEventListener("click", (event) => {
    const close = event.target.closest("[data-close]");
    if (close) {
      const dialog = $(close.dataset.close);
      backOut(dialog);
      dialog.close();
    }
    const tab = event.target.closest("button[data-tab]");
    if (tab) {
      listTab(tab.dataset.tab);
      return;
    }
    // The frame uses the address's # part for the page on screen, so this
    // handler scrolls to a section that a link on the page points to,
    // instead of opening a page by that ID.
    const link = event.target.closest('a[href^="#"]');
    if (link && $("page-content").contains(link)) {
      const id = decodeURIComponent(link.getAttribute("href").slice(1));
      const section =
        id && $("page-content").querySelector(`[id="${CSS.escape(id)}"]`);
      if (section && !pages.some((item) => item.id === id)) {
        event.preventDefault();
        land({ target: id });
        return;
      }
    }
    const navigation = event.target.closest("[data-page]");
    if (navigation) {
      event.preventDefault();
      if (listedTab !== selectedTab && $("page-list").contains(navigation))
        switchTab(listedTab, null, { showPage: false });
      show(navigation.dataset.page);
    }
    if (!feedbackEditable()) return;
    const comment = event.target.closest("[data-comment]");
    if (comment && $("page-content").contains(comment))
      openNote({
        topic: page.id,
        anchor: comment.dataset.comment || page.title,
        target: comment.closest("[id]")?.id || null,
      });
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
  document.addEventListener("keydown", (event) => {
    /* Enter types a newline in a textarea, so Shift+Enter presses a
       question's Answer and the note dialog's Add to feedback. When the note
       dialog only starts a thread, the frame hides Add to feedback, and
       Shift+Enter types a newline. */
    if (shiftEnter(event) && feedbackEditable()) {
      const area = event.target.closest("textarea");
      const answer = area
        ?.closest("[data-question]")
        ?.querySelector("[data-answer]");
      if (answer && !answer.disabled) {
        event.preventDefault();
        answer.click();
        return;
      }
      if (
        area === $("note-text") &&
        !$("note-save").hidden &&
        area.value.trim()
      ) {
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
    /* A key typed into a text field or a select belongs to that control, so
       the shortcuts ignore it. A checkbox or a radio button uses no typed
       keys, so the shortcuts still work while one has focus. The :read-write
       selector matches the text fields. */
    if (event.target.closest(":read-write, select")) return;
    if (document.querySelector("dialog[open]")) return;
    const key = event.key;
    if (key === "?") $("keys-dialog").showModal();
    else if (key === "n") toggleCenter(true);
    else if (key === "g") toggleSessions(undefined, true);
    else if (key === "w") {
      const entry = nextWaiting(sessionOrder, session.sessionId);
      if (entry) location.assign(entry.url);
    } else if (/^[1-9]$/.test(key)) {
      const entry = numbered[Number(key) - 1];
      if (entry && entry.id !== session.sessionId) location.assign(entry.url);
    } else if (mode === "home") {
      // Every key below acts on a page, and the home view has no page.
      return;
    } else if (key === "]" || key === "[") {
      const order = pageOrder().map((item) => item.id);
      const index = order.indexOf(shownPage());
      const next = order[index + (key === "]" ? 1 : -1)];
      if (next) show(next);
    } else if (key === "j" || key === "k") {
      const blocks = choosable();
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
    } else if (key === "c") commentOnTarget();
    else if (key === "r" && editable) show("feedback");
    else if (key === "s" && editable) {
      if ($("submit").disabled) return;
      $("submit").focus();
    } else if (key === "a") show("agreed");
    else return;
    event.preventDefault();
  });
}
