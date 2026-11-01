import { $, apple } from "#frame/app/util.mjs";
import { session } from "#frame/app/view.mjs";
import { escapeHtml, marked, snippet, whereLine } from "#frame/search/rows.mjs";

const KINDS = [
  ["pages", "Pages"],
  ["threads", "Threads"],
  ["notes", "Notes"],
  ["answers", "Answers"],
  ["proposals", "Proposals"],
  ["agreed", "Agreed"],
];
const WIDER = {
  kinds: "every kind",
  rounds: "all rounds",
  sessions: "all sessions",
};
const PHONE = 720;

const icon = (paths) =>
  `<svg class="search-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const GLYPHS = {
  pages: icon('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
  threads: icon(
    '<path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L3.5 20l1.4-4.6a8 8 0 1 1 15.6-3.9z"/>',
  ),
  notes: icon('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  answers: icon(
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M8 12l3 3 5-6"/>',
  ),
  proposals: icon(
    '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
  ),
  agreed: icon(
    '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  ),
  code: icon('<path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/>'),
};

// The search stays as the reader left it for as long as the tab is open.
const state = {
  query: "",
  allSessions: false,
  allRounds: true,
  kinds: new Set(),
  selected: 0,
};
let dialog;
function openResult(row) {
  const target = Number.isInteger(row.block)
    ? `?target=block-${encodeURIComponent(row.page)}-${row.block}`
    : "";
  location.assign(
    `/s/${row.session}/r/${encodeURIComponent(row.round)}${target}#${encodeURIComponent(row.page)}`,
  );
}

// The body of the preview pane: the row's heading and text, its words marked.
function showPreview(pane, row) {
  pane.innerHTML = row
    ? `<h3>${marked(row.heading || row.pageTitle || "Untitled", row.heading ? row.headingRanges : null)}</h3><div class="search-text${row.code ? " is-code" : ""}">${marked(row.text, row.ranges)}</div>`
    : "";
  pane
    .querySelector(".search-text mark")
    ?.scrollIntoView({ block: "center", behavior: "instant" });
}

export const searchOpen = () => Boolean(dialog?.open);
export function openSearch() {
  dialog?.open || dialog?.dispatchEvent(new Event("search:open"));
}
export function closeSearch() {
  dialog?.close();
}

export function installSearch() {
  const button = $("search-button");
  button.hidden = false;
  dialog = document.createElement("dialog");
  dialog.className = "search";
  dialog.id = "search-dialog";
  dialog.setAttribute("aria-label", "Search");
  dialog.innerHTML = `
    <div class="search-left">
      <div class="search-top">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/></svg>
        <input class="search-input" type="search" role="combobox" aria-expanded="true" aria-controls="search-list" aria-autocomplete="list" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" placeholder="Search" />
        <button class="search-cancel" type="button">Cancel</button>
      </div>
      <div class="search-filters">
        <button class="search-filter" type="button" data-toggle="allSessions"></button>
        <button class="search-filter" type="button" data-toggle="allRounds"></button>
        <button class="search-filter search-kinds-button" type="button" aria-expanded="false"></button>
        <output class="search-count"></output>
        <div class="search-kinds" role="group" aria-label="Kinds" hidden></div>
      </div>
      <div class="search-list" id="search-list" role="listbox" aria-label="Results"></div>
    </div>
    <aside class="search-preview">
      <div class="search-sheet-bar">
        <button class="search-back" type="button">‹ Results</button>
        <span class="search-sheet-where"></span>
        <button class="search-open" type="button">Open</button>
      </div>
      <div class="search-preview-head">
        <div class="search-crumbs"></div>
        <button class="search-open" type="button">Open ↵</button>
      </div>
      <div class="search-preview-main"></div>
    </aside>`;
  document.body.append(dialog);
  const part = (selector) => dialog.querySelector(selector);
  const input = part(".search-input");
  const list = part(".search-list");
  const kinds = part(".search-kinds");
  const kindsButton = part(".search-kinds-button");
  let current = { results: [], counts: {}, total: 0 };
  let request = null;
  let lastPointer = null;

  kinds.innerHTML =
    `<button class="search-kind" type="button" data-kind=""><span>All kinds</span></button>` +
    KINDS.map(
      ([id, label]) =>
        `<button class="search-kind" type="button" data-kind="${id}"><span>${label}</span><b></b></button>`,
    ).join("");
  const showKinds = (open) => {
    kinds.hidden = !open;
    kindsButton.setAttribute("aria-expanded", String(open));
  };
  const focusField = () => innerWidth > PHONE && input.focus();

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
      : chosen.length < 3
        ? chosen.join(", ")
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
    part(".search-count").textContent = state.query.trim()
      ? `${current.total} result${current.total === 1 ? "" : "s"}`
      : "";
  }

  function drawList() {
    const { results } = current;
    if (!results.length) {
      const scope = state.allSessions ? "any session" : "this session";
      const wider = current.wider;
      list.innerHTML = `<div class="search-blank"><span>${
        state.query.trim()
          ? `No matches for “${escapeHtml(state.query.trim())}” here.`
          : `Nothing in ${scope} yet.`
      }</span>${
        wider
          ? `<button type="button" data-wider="${wider.filter}">Show ${wider.total} in ${WIDER[wider.filter]}</button>`
          : ""
      }</div>`;
      return;
    }
    let html = "";
    results.forEach((row, index) => {
      html += `<div class="search-row" id="search-row-${index}" role="option" data-i="${index}" aria-selected="${index === state.selected}">
        ${row.code ? GLYPHS.code : GLYPHS[row.kind]}
        <div>
          <div class="search-title">${marked(row.heading || row.pageTitle || "Untitled", row.heading ? row.headingRanges : null)}</div>
          ${row.text ? `<div class="search-snippet">${snippet(row.text, row.ranges)}</div>` : ""}
          <div class="search-where">${escapeHtml(whereLine(row, state))}</div>
        </div>
      </div>`;
    });
    if (current.total > results.length)
      html += `<div class="search-end">Showing the best ${results.length} of ${current.total}. Keep typing to narrow them.</div>`;
    if (current.loading)
      html += `<div class="search-end">Still reading older sessions, so more may appear.</div>`;
    list.innerHTML = html;
    input.setAttribute("aria-activedescendant", `search-row-${state.selected}`);
  }

  function drawPreview() {
    const row = current.results[state.selected];
    part(".search-crumbs").innerHTML = row
      ? [row.sessionTitle, row.round && `Round ${row.round}`, row.pageTitle]
          .filter(Boolean)
          .map((crumb) => `<span>${escapeHtml(crumb)}</span>`)
          .join("")
      : "";
    part(".search-sheet-where").textContent = row
      ? row.pageTitle || (row.round ? `Round ${row.round}` : row.sessionTitle)
      : "";
    for (const open of dialog.querySelectorAll(".search-open"))
      open.disabled = !row;
    showPreview(part(".search-preview-main"), row);
  }

  async function run() {
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
    try {
      const reply = await fetch(`/api/search?${params}`, {
        signal: request.signal,
      });
      if (!reply.ok) throw Error("Search failed.");
      current = await reply.json();
    } catch (error) {
      // A newer search replaced this one, so its answer no longer matters.
      if (error.name === "AbortError") return;
      current = { results: [], counts: {}, total: 0 };
      drawControls();
      list.innerHTML = `<div class="search-blank"><span>Search could not reach the hub.</span></div>`;
      drawPreview();
      return;
    }
    state.selected = 0;
    drawControls();
    drawList();
    drawPreview();
    list.scrollTop = 0;
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
    openResult(row);
  }
  function chooseRow(index) {
    moveSelection(index);
    if (innerWidth > PHONE) return openSelected();
    dialog.classList.add("is-sheet");
    input.blur();
  }

  function open() {
    if (!dialog.open) dialog.showModal();
    input.value = state.query;
    input.focus();
    input.select();
    void run();
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

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) return dialog.close();
    if (!event.target.closest(".search-kinds, .search-kinds-button"))
      showKinds(false);
    const toggle = event.target.closest("[data-toggle]");
    if (toggle) {
      state[toggle.dataset.toggle] = !state[toggle.dataset.toggle];
      void run();
      focusField();
      return;
    }
    if (event.target.closest(".search-kinds-button"))
      return showKinds(kinds.hidden);
    const kind = event.target.closest(".search-kind");
    if (kind) {
      const id = kind.dataset.kind;
      if (!id) state.kinds.clear();
      else if (state.kinds.has(id)) state.kinds.delete(id);
      else state.kinds.add(id);
      void run();
      focusField();
      return;
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
    if (event.target.closest(".search-cancel")) return dialog.close();
    if (event.target.closest(".search-back")) return closeSheet();
    if (event.target.closest(".search-open")) return openSelected();
    const row = event.target.closest(".search-row");
    if (row) chooseRow(Number(row.dataset.i));
  });

  // A row follows the pointer only when the pointer moved, so a list that
  // redraws under a resting pointer keeps the keyboard's selection.
  list.addEventListener("mousemove", (event) => {
    const here = `${event.clientX},${event.clientY}`;
    if (here === lastPointer) return;
    lastPointer = here;
    const row = event.target.closest(".search-row");
    if (row && Number(row.dataset.i) !== state.selected)
      moveSelection(Number(row.dataset.i));
  });
  // Scrolling the results on a phone drops the keyboard, so more rows show.
  list.addEventListener("touchmove", () => input.blur(), { passive: true });

  input.addEventListener("input", () => {
    state.query = input.value;
    void run();
  });

  dialog.addEventListener("close", () => {
    showKinds(false);
    closeSheet();
    button.focus({ preventScroll: true });
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    event.stopPropagation();
    const key = event.key;
    const modifier = apple() ? event.metaKey : event.ctrlKey;
    // A search field clears its text on Esc and keeps the dialog open, so the
    // modal handles Esc itself and keeps the query for the next time.
    if (key === "Escape") {
      event.preventDefault();
      if (!kinds.hidden) showKinds(false);
      else dialog.close();
    } else if (modifier && !event.shiftKey && key.toLowerCase() === "k") {
      event.preventDefault();
      dialog.close();
    } else if (key === "ArrowDown" || (event.ctrlKey && key === "n")) {
      event.preventDefault();
      moveSelection(state.selected + 1);
    } else if (key === "ArrowUp" || (event.ctrlKey && key === "p")) {
      event.preventDefault();
      moveSelection(state.selected - 1);
    } else if (key === "Enter") {
      event.preventDefault();
      openSelected();
    } else if (event.altKey && event.code === "KeyS") {
      event.preventDefault();
      state.allSessions = !state.allSessions;
      void run();
    } else if (event.altKey && event.code === "KeyR") {
      event.preventDefault();
      state.allRounds = !state.allRounds;
      void run();
    } else if (key === "Tab") {
      event.preventDefault();
      const ids = ["", ...KINDS.map(([id]) => id)];
      const at = state.kinds.size === 1 ? ids.indexOf([...state.kinds][0]) : 0;
      const next =
        ids[(at + (event.shiftKey ? -1 : 1) + ids.length) % ids.length];
      state.kinds.clear();
      if (next) state.kinds.add(next);
      void run();
    }
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
