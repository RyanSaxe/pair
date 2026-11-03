import { fitToPhone, PHONE } from "#frame/search/fit.mjs";
import { menusHtml } from "#frame/search/menus.mjs";
import { createPreview } from "#frame/search/preview.mjs";
import { escapeHtml } from "#frame/search/rows.mjs";
import { createDialog, showPreview } from "#frame/search/window-dialog.mjs";

/* The one <dialog> that Search and Notifications share, so the two share the
   session frames that createPreview keeps loaded. A source is an object that this
   window reads, and each difference between the two windows is one field of it:

     label, listLabel, placeholder, glyph  what the window calls itself
     focusField                            whether the field takes focus on open
     selectFirst                           whether a row is selected with no click
     state                                 query, selected, row and the menus' values
     menus                                 createMenus(), drawn into the filter row
     load(signal, early)                   the rows, as { results, counts, total }
     snapshot()                            the rows, from what the source already has
     rowKey(row), rowHtml(row, index, state), blank(reply), end(reply), count(reply)
     empty                                 the right pane's words with no row selected
     preview(row)                          the row that the page in the pane goes to
     open(row, query)                      what Open does
     act(target), onShow(row, how)
     keys                                  what Alt with a key code does
     commandK()                            what ⌘K does, instead of closing
     remember(), onClose(), widen(filter), onFilter(), returnFocus() */
// A fast reply replaces the list before this, so most searches never show it.
const SEARCHING_AFTER_MS = 150;
// How far a key moves the selection. Ctrl+K is one of them on every system, so
// it never closes the modal.
const ARROW_STEPS = { ArrowDown: 1, ArrowUp: -1 };
const CTRL_STEPS = { j: 1, n: 1, k: -1, p: -1 };
const stepOf = (event) =>
  ARROW_STEPS[event.key] ??
  (event.ctrlKey && !event.shiftKey && CTRL_STEPS[event.key.toLowerCase()]);
const NOTHING = { results: [], counts: {}, total: 0 };

export function createWindow() {
  const dialog = createDialog();
  const part = (selector) => dialog.querySelector(selector);
  const words = part(".search-words");
  const preview = createPreview({
    host: part(".search-preview-main"),
    onShown() {
      words.hidden = true;
    },
    onFailed(row) {
      words.hidden = false;
      showPreview(words, row, source.empty);
    },
    onLoading() {
      words.hidden = true;
    },
    onKey,
    onFocus: () => phoneFit.fit(),
  });
  const input = part(".search-input");
  const list = part(".search-list");
  let source = null;
  let state = null;
  let menus = null;
  let current = NOTHING;
  let request = null;
  let searching = 0;
  let pressedOutside = false;
  // drawn is the list's HTML, so a redraw that changes nothing leaves the rows
  // alone. shownAs says what the pane last went to, for a source with no selected
  // row until a click, where a redraw must not move the page under the reader.
  let drawn = null;
  let shownAs = null;

  const focusField = () => innerWidth > PHONE && input.focus();
  const closeMenu = () => {
    menus.show(null);
    focusField();
  };
  const closeSheet = () => dialog.classList.remove("is-sheet");
  const selectedRow = () => current.results[state.selected];

  function drawControls() {
    menus.draw(current.counts);
    part(".search-count").textContent = source.count(current);
  }

  function setList(html) {
    if (html === drawn) return;
    drawn = html;
    list.innerHTML = html;
  }
  function drawList() {
    const { results } = current;
    if (!results.length) {
      setList(source.blank(current));
      input.removeAttribute("aria-activedescendant");
      return;
    }
    setList(
      results.map((row, index) => source.rowHtml(row, index, state)).join("") +
        source.end(current),
    );
    if (selectedRow())
      input.setAttribute(
        "aria-activedescendant",
        `search-row-${state.selected}`,
      );
    else input.removeAttribute("aria-activedescendant");
  }

  function drawHead() {
    const row = selectedRow();
    part(".search-preview-head").hidden = !row;
    if (!row) return;
    const place = [row.round && `Round ${row.round}`, row.pageTitle].filter(
      Boolean,
    );
    part(".search-session").textContent = place.length ? row.sessionTitle : "";
    part(".search-place").innerHTML = (
      place.length ? place : [row.sessionTitle]
    )
      .map((crumb) => `<span>${escapeHtml(crumb)}</span>`)
      .join("");
  }

  function drawPreview() {
    const row = selectedRow();
    drawHead();
    if (!row) closeSheet();
    // On a phone, a search's best result shows under the results with no tap.
    // With nothing typed, the newest rows wait for a tap. A source that selects
    // nothing by itself has a row selected only when the reader chose it.
    if (
      innerWidth <= PHONE &&
      row &&
      (!source.selectFirst || state.query.trim())
    )
      dialog.classList.add("is-sheet");
    if (innerWidth > PHONE || dialog.classList.contains("is-sheet")) {
      const shown = row && source.preview(row);
      const asked = JSON.stringify([
        source.rowKey(row),
        state.query,
        shown?.item,
      ]);
      if (source.selectFirst || asked !== shownAs)
        preview.show(shown, state.query);
      shownAs = asked;
    }
    state.row = source.rowKey(row);
    source.remember?.();
  }

  // After a list changes, the selection stays on its row. A source that selects
  // the first row goes back to it unless it was told to keep its place.
  function settleSelection(keep) {
    const index = current.results.findIndex(
      (result) => source.rowKey(result) === state.row,
    );
    state.selected = source.selectFirst
      ? keep
        ? Math.max(index, 0)
        : 0
      : index;
  }

  async function run({ keep = false } = {}) {
    drawControls();
    request?.abort();
    const asked = new AbortController();
    request = asked;
    // Until a slow reply arrives, nothing says "0 results" or "No matches" about
    // words the field no longer has.
    clearTimeout(searching);
    searching = setTimeout(() => {
      part(".search-count").textContent = "";
      if (!current.results.length)
        setList(`<div class="search-blank"><span>Searching…</span></div>`);
    }, SEARCHING_AFTER_MS);
    // A source draws what it has while it waits for the hub.
    const early = (reply) => {
      if (asked !== request || !reply.results.length) return;
      clearTimeout(searching);
      current = reply;
      settleSelection(true);
      drawControls();
      drawList();
      drawPreview();
    };
    let reply;
    try {
      reply = await source.load(asked.signal, early);
    } catch (error) {
      // A newer search replaced this one, so its answer no longer matters.
      if (error.name === "AbortError") return;
      clearTimeout(searching);
      current = NOTHING;
      drawControls();
      setList(
        `<div class="search-blank"><span>Search could not reach the hub.</span></div>`,
      );
      drawPreview();
      return;
    }
    if (asked !== request) return;
    current = reply;
    clearTimeout(searching);
    settleSelection(keep);
    drawControls();
    drawList();
    drawPreview();
    if (keep || !source.selectFirst)
      list
        .querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
    else list.scrollTop = 0;
  }

  // refresh draws the source's rows again and leaves the page in the pane alone,
  // unless its row has gone.
  function refresh() {
    if (!dialog.open || !source.snapshot) return;
    const key = state.row;
    current = source.snapshot();
    state.selected = current.results.findIndex(
      (result) => source.rowKey(result) === key,
    );
    drawControls();
    drawList();
    if (key && state.selected < 0) drawPreview();
    else drawHead();
  }

  function moveSelection(index, how = "key") {
    const count = current.results.length;
    if (!count) return;
    const next = (index + count) % count;
    list
      .querySelector('[aria-selected="true"]')
      ?.setAttribute("aria-selected", "false");
    const row = list.querySelector(`[data-i="${next}"]`);
    row?.setAttribute("aria-selected", "true");
    row?.scrollIntoView({ block: "nearest" });
    drawn = null;
    state.selected = next;
    input.setAttribute("aria-activedescendant", `search-row-${next}`);
    drawPreview();
    source.onShow?.(selectedRow(), how);
  }

  function openSelected() {
    const row = selectedRow();
    if (!row) return;
    dialog.close();
    source.open(row, state.query);
  }
  // A click shows a row, and a click on the row that's showing opens it. With the
  // keyboard up, the preview has the selected row but no row is showing yet.
  function chooseRow(index) {
    const phone = innerWidth <= PHONE;
    const typing = phone && dialog.classList.contains("is-typing");
    const previewed =
      index === state.selected &&
      (!phone || dialog.classList.contains("is-sheet"));
    if (previewed && !typing) return openSelected();
    if (phone) {
      // The list shrinks to the top half, so the row scrolls into it afterward.
      // A keyboard that's up shrinks it later, when it drops.
      dialog.classList.add("is-sheet");
      phoneFit.revealOnDrop(typing);
      input.blur();
    }
    if (!previewed) moveSelection(index, "click");
  }

  function useSource(next) {
    if (source === next) return;
    source?.onClose?.();
    request?.abort();
    closeSheet();
    source = next;
    ({ state, menus } = next);
    current = NOTHING;
    drawn = null;
    dialog.setAttribute("aria-label", next.label);
    dialog.dataset.source = next.label;
    part(".search-top").firstElementChild.outerHTML = next.glyph;
    input.placeholder = next.placeholder;
    list.setAttribute("aria-label", next.listLabel);
    part(".search-filters").innerHTML = menusHtml(menus.names);
  }
  function open(next) {
    useSource(next);
    shownAs = null;
    if (!dialog.open) {
      // showModal focuses the first control it finds. With the field inert for
      // that moment, a phone's keyboard stays down.
      input.inert = !next.focusField;
      dialog.showModal();
      input.inert = false;
      if (next.focusField) dialog.removeAttribute("tabindex");
      else {
        dialog.tabIndex = -1;
        dialog.focus({ preventScroll: true });
      }
      phoneFit.opened();
    }
    input.value = state.query;
    if (next.focusField) {
      input.focus();
      input.select();
    } else list.scrollTop = 0;
    void run({ keep: true });
    void menus.load().then(drawControls);
  }

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
      menus.opened() &&
      !event.target.closest(".search-menu, .search-menu-button")
    )
      return closeMenu();
    if (event.target === dialog) return pressedOutside && dialog.close();
    const menu = event.target.closest("[data-menu]")?.dataset.menu;
    if (event.target.closest(".search-menu-button"))
      return menus.opened() === menu ? closeMenu() : menus.show(menu);
    const item = event.target.closest(".search-menu-item");
    if (item) {
      menus.choose(menu, item.dataset.value);
      source.onFilter?.();
      return void run();
    }
    const wider = event.target.closest("[data-wider]");
    if (wider) {
      source.widen(wider.dataset.wider);
      void run();
      return focusField();
    }
    if (event.target.closest(".search-close")) return dialog.close();
    if (event.target.closest(".search-open")) return openSelected();
    if (source.act?.(event.target)) return;
    const row = event.target.closest(".search-row");
    if (row) return chooseRow(Number(row.dataset.i));
    // A click on nothing leaves the next key with the field, unless the click
    // ended a selection of the preview's text.
    if (getSelection().isCollapsed) focusField();
  });

  // Scrolling the results on a phone drops the keyboard, so the preview shows.
  list.addEventListener("touchmove", () => input.blur(), { passive: true });

  input.addEventListener("input", () => {
    state.query = input.value;
    menus.show(null);
    void run();
  });

  dialog.addEventListener("close", () => {
    preview.pause();
    menus.show(null);
    closeSheet();
    source.onClose?.();
    source.returnFocus()?.focus({ preventScroll: true });
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
      if (menus.opened()) closeMenu();
      else dialog.close();
    } else if (event.metaKey && !event.shiftKey && key.toLowerCase() === "k") {
      event.preventDefault();
      if (source.commandK) source.commandK();
      else dialog.close();
    } else if (step) {
      event.preventDefault();
      if (menus.opened()) menus.move(step);
      // With nothing selected, ↓ selects the first row and ↑ the last.
      else
        moveSelection(
          (state.selected < 0 && step < 0 ? 0 : state.selected) + step,
        );
    } else if (key === "Enter") {
      // Enter presses a control that has focus.
      if (event.target.closest("button")) return;
      event.preventDefault();
      if (menus.opened()) closeMenu();
      // With nothing selected, Enter selects the first row.
      else if (state.selected < 0) moveSelection(0);
      // A phone keyboard's Search key drops the keyboard over the results.
      else if (innerWidth <= PHONE && event.target === input) input.blur();
      else if (current.results.length) openSelected();
      else part("[data-wider]")?.click();
    } else if (event.altKey && source.keys[event.code]) {
      event.preventDefault();
      source.keys[event.code]();
    } else if (key === "Tab") {
      // Tab moves through the controls, as in the frame's dialogs.
      menus.leave();
    } else if (
      (key.length === 1 || key === "Backspace") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.target !== input &&
      !(key === " " && event.target.closest("button"))
    ) {
      // A key typed anywhere in the modal goes to the field. One typed in a
      // preview's frame has gone by the time the field has focus, so it's typed
      // here.
      menus.show(null);
      input.focus();
      if (event.view !== window && key.length === 1) {
        event.preventDefault();
        input.setRangeText(
          key,
          input.selectionStart,
          input.selectionEnd,
          "end",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }
  // While the modal is open, every key comes here first, wherever focus is,
  // because a tap on a row can leave no element focused.
  document.addEventListener("keydown", onKey, true);
  // A click inside a frame reaches only the frame, but it moves focus.
  window.addEventListener("blur", () => {
    if (dialog.open) menus.show(null);
  });

  const phoneFit = fitToPhone({
    dialog,
    input,
    list,
    writing: () => preview.writing(),
  });

  return {
    open,
    refresh,
    reload: run,
    close: () => dialog.close(),
    showing: () => (dialog.open ? source : null),
    rowAt: (index) => current.results[index],
    part,
  };
}
