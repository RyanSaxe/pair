import { $, apple } from "#frame/app/util.mjs";
import { session } from "#frame/app/view.mjs";
import { openResult } from "#frame/search/open.mjs";
import { followPointer } from "#frame/search/pointer.mjs";
import { createPreview } from "#frame/search/preview.mjs";
import {
  KINDS,
  blankHtml,
  escapeHtml,
  hasOwnText,
  marked,
  rowHtml,
  rowKey,
  titleHtml,
} from "#frame/search/rows.mjs";

const PHONE = 720;
// A fast reply replaces the list before this, so most searches never show it.
const SEARCHING_AFTER_MS = 150;
// How far a key moves the selection. Ctrl+K is one of them on every system, so
// it never closes the modal.
const ARROW_STEPS = { ArrowDown: 1, ArrowUp: -1 };
const CTRL_STEPS = { j: 1, n: 1, k: -1, p: -1 };
const stepOf = (event) =>
  ARROW_STEPS[event.key] ??
  (event.ctrlKey && !event.shiftKey && CTRL_STEPS[event.key.toLowerCase()]);

// The search stays as the reader left it for as long as the tab is open, also
// when the tab moves to another session. sessionStorage belongs to the tab, so
// nothing reaches another device.
const MEMORY = "pair:search";
const state = {
  query: "",
  allSessions: false,
  allRounds: true,
  kinds: new Set(),
  selected: 0,
  row: null,
};
function remember() {
  try {
    sessionStorage.setItem(
      MEMORY,
      JSON.stringify({ ...state, kinds: [...state.kinds] }),
    );
  } catch {
    // Without storage, the search lasts as long as the page.
  }
}
function recall() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(MEMORY));
    if (saved) Object.assign(state, saved, { kinds: new Set(saved.kinds) });
  } catch {
    // Without storage, a search starts from the defaults.
  }
}
let dialog;

// The body of the preview pane: the row's heading and text, its words marked.
function showPreview(pane, row) {
  pane.innerHTML = row
    ? `<h3>${titleHtml(row)}</h3>${hasOwnText(row) ? `<div class="search-text${row.code ? " is-code" : ""}">${marked(row.text, row.ranges)}</div>` : ""}`
    : "";
  pane
    .querySelector(".search-text mark")
    ?.scrollIntoView({ block: "center", behavior: "instant" });
}

export function openSearch() {
  dialog?.open || dialog?.dispatchEvent(new Event("search:open"));
}

export function installSearch() {
  recall();
  const button = $("search-button");
  button.hidden = false;
  // The keys dialog names this system's keys, and the home view has no threads
  // to set them.
  const [command, alt] = apple() ? ["⌘", "Option"] : ["Ctrl", "Alt"];
  for (const key of document.querySelectorAll("[data-send-modifier]"))
    key.textContent = command;
  for (const key of document.querySelectorAll("[data-alt-modifier]"))
    key.textContent = alt;
  dialog = document.createElement("dialog");
  dialog.className = "search";
  dialog.id = "search-dialog";
  dialog.setAttribute("aria-label", "Search");
  dialog.innerHTML = `
    <div class="search-left">
      <div class="search-top">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/></svg>
        <input class="search-input" type="search" role="combobox" aria-expanded="true" aria-controls="search-list" aria-autocomplete="list" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" placeholder="Search" />
        <output class="search-count"></output>
      </div>
      <div class="search-filters">
        <button class="btn search-filter" type="button" data-toggle="allSessions"></button>
        <button class="btn search-filter" type="button" data-toggle="allRounds"></button>
        <div class="search-kinds-anchor">
          <button class="btn search-filter search-kinds-button" type="button" aria-expanded="false"></button>
          <div class="search-kinds" role="group" aria-label="Kinds" hidden></div>
        </div>
      </div>
      <div class="search-list" id="search-list" role="listbox" aria-label="Results" tabindex="-1"></div>
    </div>
    <aside class="search-preview">
      <div class="search-preview-head" hidden>
        <div class="search-session"></div>
        <div class="search-place"></div>
        <button class="btn search-open" type="button">Open <kbd>↵</kbd></button>
      </div>
      <div class="search-preview-main"><div class="search-words"></div></div>
    </aside>`;
  const close = $("close-button").content.firstElementChild.cloneNode(true);
  close.classList.add("search-close");
  dialog.append(close);
  document.body.append(dialog);
  const part = (selector) => dialog.querySelector(selector);
  const words = part(".search-words");
  const preview = createPreview({
    host: part(".search-preview-main"),
    onShown() {
      words.hidden = true;
    },
    onFailed(row) {
      words.hidden = false;
      showPreview(words, row);
    },
    onLoading() {
      words.hidden = false;
      words.innerHTML = '<p class="search-loading">Loading…</p>';
    },
    onKey,
  });
  const input = part(".search-input");
  const list = part(".search-list");
  const kinds = part(".search-kinds");
  const kindsButton = part(".search-kinds-button");
  let current = { results: [], counts: {}, total: 0 };
  let request = null;
  let searching = 0;
  let pressedOutside = false;

  kinds.innerHTML =
    `<button class="search-kind" type="button" data-kind=""><span>All kinds</span></button>` +
    KINDS.map(
      ([id, label]) =>
        `<button class="search-kind" type="button" data-kind="${id}"><span>${label}</span><b></b></button>`,
    ).join("");
  const focusField = () => innerWidth > PHONE && input.focus();
  // The keys move through the menu from the moment it opens.
  const showKinds = (open) => {
    kinds.hidden = !open;
    kindsButton.setAttribute("aria-expanded", String(open));
    if (open) kinds.firstElementChild.focus();
  };
  const closeKinds = () => {
    showKinds(false);
    focusField();
  };
  function moveInKinds(step) {
    const items = [...kinds.children];
    const at = items.indexOf(document.activeElement);
    items[(at + step + items.length) % items.length].focus();
  }

  function drawControls() {
    const sessions = part('[data-toggle="allSessions"]');
    sessions.textContent = state.allSessions ? "All sessions" : "This session";
    sessions.classList.toggle("is-set", state.allSessions);
    const rounds = part('[data-toggle="allRounds"]');
    rounds.textContent = state.allRounds ? "All rounds" : "Latest round";
    rounds.classList.toggle("is-set", !state.allRounds);
    const chosen = KINDS.filter(([id]) => state.kinds.has(id)).map(
      ([, label]) => label,
    );
    kindsButton.textContent = !chosen.length
      ? "All kinds"
      : chosen.length === 1
        ? chosen[0]
        : `${chosen.length} kinds`;
    kindsButton.classList.toggle("is-set", chosen.length > 0);
    for (const kind of kinds.children) {
      const id = kind.dataset.kind;
      kind.setAttribute(
        "aria-pressed",
        String(id ? state.kinds.has(id) : state.kinds.size === 0),
      );
      if (id) {
        kind.querySelector("b").textContent = current.counts[id] ?? 0;
        kind.dataset.empty = String(!current.counts[id]);
      }
    }
    part(".search-count").textContent =
      state.query.trim() && current.total
        ? `${current.total} result${current.total === 1 ? "" : "s"}`
        : "";
  }

  function drawList() {
    const { results, total, loading } = current;
    if (!results.length) {
      list.innerHTML = blankHtml(state, current);
      input.removeAttribute("aria-activedescendant");
      return;
    }
    let html = results.map((row, index) => rowHtml(row, index, state)).join("");
    if (total > results.length)
      html += `<div class="search-end">${
        state.query.trim()
          ? `Showing the best ${results.length} of ${total}. Keep typing to narrow them.`
          : `Showing the newest ${results.length} of ${total}.`
      }</div>`;
    if (loading)
      html += `<div class="search-end">Still reading older sessions, so more may appear.</div>`;
    list.innerHTML = html;
    input.setAttribute("aria-activedescendant", `search-row-${state.selected}`);
  }

  function drawPreview() {
    const row = current.results[state.selected];
    part(".search-preview-head").hidden = !row;
    if (row) {
      const place = [row.round && `Round ${row.round}`, row.pageTitle].filter(
        Boolean,
      );
      part(".search-session").textContent = place.length
        ? row.sessionTitle
        : "";
      part(".search-place").innerHTML = (
        place.length ? place : [row.sessionTitle]
      )
        .map((crumb) => `<span>${escapeHtml(crumb)}</span>`)
        .join("");
    } else closeSheet();
    preview.show(row, state.query);
    state.row = rowKey(row);
    remember();
  }

  async function run({ keep = false } = {}) {
    drawControls();
    request?.abort();
    request = new AbortController();
    const params = new URLSearchParams({
      q: state.query,
      here: session.sessionId,
    });
    if (!state.allSessions) params.set("session", session.sessionId);
    if (!state.allRounds) params.set("round", "latest");
    if (state.kinds.size) params.set("kinds", [...state.kinds].join(","));
    // Until a slow reply arrives, nothing says "0 results" or "No matches" about
    // words the field no longer has.
    clearTimeout(searching);
    searching = setTimeout(() => {
      part(".search-count").textContent = "";
      if (!current.results.length)
        list.innerHTML = `<div class="search-blank"><span>Searching…</span></div>`;
    }, SEARCHING_AFTER_MS);
    try {
      const reply = await fetch(`/api/search?${params}`, {
        signal: request.signal,
      });
      if (!reply.ok) throw Error("Search failed.");
      current = await reply.json();
    } catch (error) {
      // A newer search replaced this one, so its answer no longer matters.
      if (error.name === "AbortError") return;
      clearTimeout(searching);
      current = { results: [], counts: {}, total: 0 };
      drawControls();
      list.innerHTML = `<div class="search-blank"><span>Search could not reach the hub.</span></div>`;
      drawPreview();
      return;
    }
    clearTimeout(searching);
    const row = state.row;
    state.selected = keep
      ? Math.max(
          current.results.findIndex((result) => rowKey(result) === row),
          0,
        )
      : 0;
    drawControls();
    drawList();
    drawPreview();
    if (keep)
      list
        .querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
    else list.scrollTop = 0;
  }

  function moveSelection(index) {
    const count = current.results.length;
    if (!count) return;
    const next = (index + count) % count;
    list
      .querySelector('[aria-selected="true"]')
      ?.setAttribute("aria-selected", "false");
    const row = list.querySelector(`[data-i="${next}"]`);
    row?.setAttribute("aria-selected", "true");
    row?.scrollIntoView({ block: "nearest" });
    state.selected = next;
    input.setAttribute("aria-activedescendant", `search-row-${next}`);
    drawPreview();
  }

  const closeSheet = () => dialog.classList.remove("is-sheet");
  function openSelected() {
    const row = current.results[state.selected];
    if (!row) return;
    dialog.close();
    openResult(row, state.query);
  }
  function chooseRow(index) {
    if (innerWidth > PHONE) {
      moveSelection(index);
      return openSelected();
    }
    // The list shrinks to the top half, so the row scrolls into it afterward.
    dialog.classList.add("is-sheet");
    input.blur();
    moveSelection(index);
  }

  function open() {
    if (!dialog.open) dialog.showModal();
    pointer.reset();
    input.value = state.query;
    input.focus();
    input.select();
    void run({ keep: true });
  }
  dialog.addEventListener("search:open", open);
  button.addEventListener("click", open);

  // The frame chooses a block or starts a note on clicks in a page, so nothing
  // the reader does in the modal may reach its listeners.
  for (const type of [
    "click",
    "mousedown",
    "mouseup",
    "pointerdown",
    "pointerup",
  ])
    dialog.addEventListener(type, (event) => event.stopPropagation());

  // A click counts as outside only when the press landed outside too, so a drag
  // that selects the preview's text and ends on the backdrop leaves it open.
  dialog.addEventListener("pointerdown", (event) => {
    pressedOutside = event.target === dialog;
  });
  dialog.addEventListener("click", (event) => {
    // A click outside the menu only closes the menu.
    if (
      !kinds.hidden &&
      !event.target.closest(".search-kinds, .search-kinds-button")
    )
      return closeKinds();
    if (event.target === dialog) return pressedOutside && dialog.close();
    const toggle = event.target.closest("[data-toggle]");
    if (toggle) {
      state[toggle.dataset.toggle] = !state[toggle.dataset.toggle];
      void run();
      // A key press has no click count, and it keeps its place in the Tab order.
      if (event.detail) focusField();
      return;
    }
    if (event.target.closest(".search-kinds-button"))
      return kinds.hidden ? showKinds(true) : closeKinds();
    const kind = event.target.closest(".search-kind");
    if (kind) {
      const id = kind.dataset.kind;
      if (!id) state.kinds.clear();
      else if (state.kinds.has(id)) state.kinds.delete(id);
      else state.kinds.add(id);
      return void run();
    }
    const wider = event.target.closest("[data-wider]");
    if (wider) {
      const filter = wider.dataset.wider;
      state.kinds.clear();
      if (filter !== "kinds") state.allRounds = true;
      if (filter === "sessions") state.allSessions = true;
      void run();
      return focusField();
    }
    if (event.target.closest(".search-close")) return dialog.close();
    if (event.target.closest(".search-open")) return openSelected();
    const row = event.target.closest(".search-row");
    if (row) return chooseRow(Number(row.dataset.i));
    // A click on nothing leaves the next key with the field, unless the click
    // ended a selection of the preview's text.
    if (getSelection().isCollapsed) focusField();
  });

  const pointer = followPointer(list, {
    paused: () => !kinds.hidden,
    select: (index) => index !== state.selected && moveSelection(index),
  });
  // Scrolling the results on a phone drops the keyboard, so more rows show.
  list.addEventListener("touchmove", () => input.blur(), { passive: true });

  input.addEventListener("input", () => {
    state.query = input.value;
    showKinds(false);
    void run();
  });
  // Focus raises a phone's keyboard, and the results need the room.
  input.addEventListener("focus", closeSheet);

  dialog.addEventListener("close", () => {
    preview.pause();
    showKinds(false);
    closeSheet();
    button.focus({ preventScroll: true });
  });

  function onKey(event) {
    if (!dialog.open || event.isComposing) return;
    event.stopPropagation();
    const key = event.key;
    const step = stepOf(event);
    // A search field clears its text on Esc and keeps the dialog open, so the
    // modal handles Esc itself and keeps the query for the next time.
    if (key === "Escape") {
      event.preventDefault();
      if (!kinds.hidden) closeKinds();
      else dialog.close();
    } else if (event.metaKey && !event.shiftKey && key.toLowerCase() === "k") {
      event.preventDefault();
      dialog.close();
    } else if (step) {
      event.preventDefault();
      if (kinds.hidden) moveSelection(state.selected + step);
      else moveInKinds(step);
    } else if (key === "Enter") {
      // Enter presses a control that has focus.
      if (event.target.closest("button")) return;
      event.preventDefault();
      if (!kinds.hidden) closeKinds();
      // A phone keyboard's Search key drops the keyboard over the results.
      else if (innerWidth <= PHONE && event.target === input) input.blur();
      else if (current.results.length) openSelected();
      else part("[data-wider]")?.click();
    } else if (event.altKey && event.code === "KeyS") {
      event.preventDefault();
      state.allSessions = !state.allSessions;
      void run();
    } else if (event.altKey && event.code === "KeyR") {
      event.preventDefault();
      state.allRounds = !state.allRounds;
      void run();
    } else if (key === "Tab") {
      // Tab moves through the controls, as in the frame's dialogs. From the
      // menu, it moves on from the button that opened the menu.
      if (!kinds.hidden) {
        showKinds(false);
        kindsButton.focus();
      }
    } else if (
      (key.length === 1 || key === "Backspace") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.target !== input &&
      !(key === " " && event.target.closest("button"))
    ) {
      // A key typed anywhere in the modal goes to the field.
      showKinds(false);
      input.focus();
    }
  }
  // While the modal is open, every key comes here first, wherever focus is,
  // because a tap on a row can leave no element focused.
  document.addEventListener("keydown", onKey, true);
  // A click inside a frame reaches only the frame, but it moves focus.
  window.addEventListener("blur", () => {
    if (dialog.open) showKinds(false);
  });

  // iOS keeps 100dvh when the keyboard opens, so the modal follows the visual
  // viewport to stop the last results sitting under the keyboard.
  const fit = () => {
    if (window.visualViewport)
      dialog.style.setProperty("--search-height", `${visualViewport.height}px`);
  };
  visualViewport?.addEventListener("resize", fit);
  fit();
}
