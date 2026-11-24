import { openDrawer } from "#frame/app/drawer.mjs";
import { land } from "#frame/app/places.mjs";
import { listedTab, selectedTab } from "#frame/app/state.mjs";
import { save, state } from "#frame/app/store.mjs";
import { $, apple, controlKey, shiftEnter } from "#frame/app/util.mjs";
import {
  editable,
  embedded,
  mode,
  online,
  page,
  pages,
  plan,
  session,
  shownPage,
} from "#frame/app/view.mjs";
import {
  choosable,
  chooseBlock,
  chosen,
  commentOnTarget,
} from "#frame/notes/blocks.mjs";
import { restoreChoices } from "#frame/notes/controls.mjs";
import { settleNoteImages, yieldNote } from "#frame/notes/note-dialog.mjs";
import { openNote } from "#frame/notes/notes.mjs";
import { sendKeyLabel } from "#frame/notes/send-key.mjs";
import { pageOrder, show } from "#frame/pages/pages.mjs";
import { feedbackEditable } from "#frame/review/send-state.mjs";
import { openSearch } from "#frame/search/modal.mjs";
import { toggleCenter } from "#frame/sync/center.mjs";
import { clearOwnRound } from "#frame/sync/center-state.mjs";
import { closeMenus } from "#frame/sync/rounds-panel.mjs";
import { listTab, switchTab } from "#frame/sync/rounds.mjs";
import {
  nextWaiting,
  numbered,
  openSession,
  sessionOrder,
  toggleSessions,
} from "#frame/sync/sessions.mjs";

/* The ×, Escape and a click outside a modal each call backOut(). Backing out
   of the note dialog keeps its text as a draft, and settleNoteImages() drops
   the images uploaded from it. */
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

/* Focus can drop off a text field on the page or in a drawer while the reviewer
   types, and the next keys are still their words, so the shortcuts wait for a
   pause in the keys. A field in a modal leaves with the modal, and a drawer that
   closes has finished its words. */
const TYPING_PAUSE_MS = 1500;
let typedAt = -Infinity;

function handlePageHashClick(event) {
  // The frame uses the address's # part for the page on screen, so this
  // handler scrolls to a section that a link on the page points to,
  // instead of opening a page by that ID.
  const link = event.target.closest('a[href^="#"]');
  if (!link || !$("page-content").contains(link)) return false;
  const id = decodeURIComponent(link.getAttribute("href").slice(1));
  const section =
    id && $("page-content").querySelector(`[id="${CSS.escape(id)}"]`);
  if (!section || pages.some((item) => item.id === id)) return false;
  event.preventDefault();
  land({ target: id });
  return true;
}

function toggleChoice(choice) {
  const group = choice.closest("[data-choice]");
  const id = controlKey(page.id, group.dataset.choice);
  if (state.choices[id]?.value === choice.dataset.value) {
    delete state.choices[id];
  } else {
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
  }
  restoreChoices();
  save();
}

function handleFeedbackClick(event) {
  if (!feedbackEditable()) return;
  const comment = event.target.closest("[data-comment]");
  if (comment && $("page-content").contains(comment)) {
    openNote({
      topic: page.id,
      anchor: comment.dataset.comment || page.title,
      target: comment.closest("[id]")?.id || null,
    });
  }
  const choice = event.target.closest("[data-choice] [data-value]");
  if (choice && $("page-content").contains(choice)) toggleChoice(choice);
}

function onDocumentClick(event) {
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
  if (handlePageHashClick(event)) return;
  const navigation = event.target.closest("[data-page]");
  if (navigation) {
    event.preventDefault();
    if (listedTab !== selectedTab && $("page-list").contains(navigation)) {
      switchTab(listedTab, null, { showPage: false });
    }
    show(navigation.dataset.page);
    clearOwnRound();
  }
  handleFeedbackClick(event);
}

function handleShiftEnter(event) {
  /* Enter types a newline in a textarea, so Shift+Enter presses a
     question's Answer and the note dialog's Add to draft. When the note
     dialog only starts a thread, the frame hides Add to draft, and
     Shift+Enter types a newline. */
  if (!shiftEnter(event) || !feedbackEditable()) return false;
  const area = event.target.closest("textarea");
  const answer = area
    ?.closest("[data-question]")
    ?.querySelector("[data-answer]");
  if (answer && !answer.disabled) {
    event.preventDefault();
    typedAt = -Infinity;
    answer.click();
    return true;
  }
  if (area === $("note-text") && !$("note-save").hidden && area.value.trim()) {
    event.preventDefault();
    $("note-form").requestSubmit();
    return true;
  }
  return false;
}

function isSearchShortcut(event) {
  return (
    online &&
    mode !== "preview" &&
    (apple() ? event.metaKey : event.ctrlKey) &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k" &&
    !$("drawing-dialog").open
  );
}

function handleEscape() {
  /* The browser closes a modal on Escape, and a drawer gets no cancel event,
     so this handler closes the top thing that is left: a menu, then a drawer.
     closeMenus() hides the menus, so the test for one comes first. */
  if (document.querySelector("dialog:modal")) return;
  const menu = document.querySelector(":popover-open");
  closeMenus();
  const drawer = document.querySelector("dialog[data-drawer][open]");
  if (!menu && drawer) {
    backOut(drawer);
    drawer.close();
  }
}

function stepBlock(key) {
  const blocks = choosable();
  if (!blocks.length) return false;
  const index = blocks.indexOf(chosen);
  let nextIndex;
  if (index < 0) nextIndex = key === "j" ? 0 : blocks.length - 1;
  else {
    nextIndex =
      (index + (key === "j" ? 1 : -1) + blocks.length) % blocks.length;
  }
  const next = blocks[nextIndex];
  // chooseBlock toggles, so landing on the current block would clear it.
  if (next !== chosen) chooseBlock(next);
  next.tabIndex = -1;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "center" });
  return true;
}

function handleNumberedSessionKey(key) {
  if (!/^[1-9]$/.test(key)) return false;
  const entry = numbered[Number(key) - 1];
  if (entry && entry.id !== session.sessionId) openSession(entry);
  return true;
}

const globalShortcuts = {
  "?": () => {
    if ($("keys-dialog").open) $("keys-dialog").close();
    else if (yieldNote()) openDrawer($("keys-dialog"), { home: "header" });
    return true;
  },
  "/": () => {
    if (!online) return false;
    openSearch();
    return true;
  },
  n: () => {
    toggleCenter(true);
    return true;
  },
  g: () => {
    toggleSessions(undefined, true);
    return true;
  },
  w: () => {
    const entry = nextWaiting(sessionOrder, session.sessionId);
    if (entry) openSession(entry);
    return true;
  },
};

function handleGlobalShortcut(key) {
  const action = globalShortcuts[key];
  if (action) return action();
  return handleNumberedSessionKey(key);
}

function stepPage(direction) {
  const order = pageOrder().map((item) => item.id);
  const next = order[order.indexOf(shownPage()) + direction];
  if (next) {
    show(next);
    clearOwnRound();
  }
  return true;
}

const pageShortcuts = {
  "]": () => stepPage(1),
  "[": () => stepPage(-1),
  j: () => stepBlock("j"),
  k: () => stepBlock("k"),
  c: () => {
    commentOnTarget();
    return true;
  },
  r: () => {
    if (!editable) return false;
    show("feedback");
    clearOwnRound();
    return true;
  },
  s: () => {
    if (!editable || $("submit").disabled) return false;
    $("submit").focus();
    return true;
  },
  a: () => {
    show("agreed");
    clearOwnRound();
    return true;
  },
};

function handlePageShortcut(key) {
  const action = pageShortcuts[key];
  return action ? action() : false;
}

function shortcutBlocked(event) {
  /* A key typed into a text field or a select belongs to that control, so
     the shortcuts ignore it. A checkbox or a radio button uses no typed
     keys, so the shortcuts still work while one has focus. The :read-write
     selector matches the text fields. */
  if (
    event.target.closest(":read-write, select") ||
    document.querySelector("dialog:modal")
  ) {
    return true;
  }
  if (event.timeStamp - typedAt < TYPING_PAUSE_MS) {
    typedAt = event.timeStamp;
    return true;
  }
  return false;
}

function hasModifierKey(event) {
  return event.metaKey || event.ctrlKey || event.altKey;
}

function runShortcutKey(key) {
  if (handleGlobalShortcut(key)) return true;
  return mode !== "home" && handlePageShortcut(key);
}

function onDocumentKeydown(event) {
  if (handleShiftEnter(event)) return;
  if (isSearchShortcut(event)) {
    event.preventDefault();
    openSearch();
    return;
  }
  if (mode === "preview" || hasModifierKey(event)) return;
  if (event.key === "Escape") {
    handleEscape();
    return;
  }
  if (embedded || shortcutBlocked(event)) return;
  if (runShortcutKey(event.key)) event.preventDefault();
}

export function installEvents() {
  document.addEventListener(
    "input",
    (event) => {
      if (
        event.target.matches(":read-write") &&
        !event.target.closest("dialog:modal")
      ) {
        typedAt = event.timeStamp;
      }
    },
    true,
  );
  for (const head of document.querySelectorAll(
    "dialog :is(.dialog-head, .drawing-head)",
  )) {
    const close = $("close-button").content.firstElementChild.cloneNode(true);
    close.dataset.close = head.closest("dialog").id;
    if (head.dataset.closeLabel) {
      close.setAttribute("aria-label", head.dataset.closeLabel);
    }
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
    dialog.addEventListener("close", () => (typedAt = -Infinity));
  }
  // The keys dialog names this system's keys, and the home view has no threads
  // to set them.
  for (const key of $("keys-dialog").querySelectorAll("[data-send-key]")) {
    key.textContent = sendKeyLabel();
  }
  // A click inside an embedded frame never reaches this document, but it
  // moves focus, so the frame closes menus on blur as well as on outside
  // clicks.
  window.addEventListener("blur", closeMenus);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);
}
