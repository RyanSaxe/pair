import { $, apple } from "#frame/app/util.mjs";
import { session } from "#frame/app/view.mjs";
import { searchMenus } from "#frame/search/menus.mjs";
import { openResult } from "#frame/search/open.mjs";
import { blankHtml, HERE, rowHtml, rowKey } from "#frame/search/rows.mjs";
import { createWindow } from "#frame/search/window.mjs";

// The search stays as the reader left it for as long as the tab is open, also
// when the tab moves to another session. sessionStorage belongs to the tab, so
// nothing reaches another device.
const MEMORY = "pair:search";
const state = {
  query: "",
  sessions: [HERE],
  closed: false,
  rounds: [],
  kinds: [],
  selected: 0,
  row: null,
};
function remember() {
  try {
    sessionStorage.setItem(MEMORY, JSON.stringify(state));
  } catch {
    // Without storage, the search lasts as long as the page.
  }
}
function recall() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(MEMORY));
    if (saved) Object.assign(state, saved);
  } catch {
    // Without storage, a search starts from the defaults.
  }
}
const GLYPH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/></svg>';

let shared = null;
let source = null;
// The one window that Search and Notifications share.
export const sharedWindow = () => shared;

/* Notifications sends the reader here with words it couldn't find, so the search
   covers all of pair. With no words, Search opens as the reader left it. */
export function openSearch(words = "") {
  if (!shared) return;
  if (words) {
    Object.assign(state, {
      query: words,
      sessions: [],
      rounds: [],
      kinds: [],
      closed: true,
      selected: 0,
      row: null,
    });
    remember();
  }
  if (shared.showing() !== source) shared.open(source);
}

function searchSource(win) {
  const menus = searchMenus({ host: win.part(".search-filters"), state });
  return {
    label: "Search",
    listLabel: "Results",
    placeholder: "Search",
    glyph: GLYPH,
    focusField: true,
    selectFirst: true,
    state,
    menus,
    async load(signal) {
      const params = new URLSearchParams({
        q: state.query,
        here: session.sessionId,
      });
      if (state.sessions.length) params.set("session", menus.sessionIds());
      if (state.rounds.length) params.set("round", state.rounds.join(","));
      if (state.kinds.length) params.set("kinds", state.kinds.join(","));
      if (state.closed) params.set("closed", "1");
      const reply = await fetch(`/api/search?${params}`, { signal });
      if (!reply.ok) throw Error("Search failed.");
      return reply.json();
    },
    rowKey,
    rowHtml,
    blank: (reply) => blankHtml(state, reply),
    end({ results, total, loading }) {
      let html = "";
      if (total > results.length)
        html += `<div class="search-end">${
          state.query.trim()
            ? `Showing the best ${results.length} of ${total}. Keep typing to narrow them.`
            : `Showing the newest ${results.length} of ${total}.`
        }</div>`;
      if (loading)
        html += `<div class="search-end">Still reading older sessions, so more may appear.</div>`;
      return html;
    },
    count: ({ total }) =>
      state.query.trim() && total
        ? `${total} result${total === 1 ? "" : "s"}`
        : "",
    preview: (row) => row,
    open: openResult,
    keys: {
      KeyS() {
        menus.switchSessions();
        void win.reload();
      },
      KeyR() {
        menus.switchRounds();
        void win.reload();
      },
    },
    remember,
    widen(filter) {
      state.kinds = [];
      if (filter !== "kinds") state.rounds = [];
      if (filter === "sessions" || filter === "closed") state.sessions = [];
      if (filter === "closed") state.closed = true;
    },
    returnFocus: () => $("search-button"),
  };
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
  shared = createWindow();
  source = searchSource(shared);
  button.addEventListener("click", () => shared.open(source));
}
