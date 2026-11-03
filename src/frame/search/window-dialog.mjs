import { $ } from "#frame/app/util.mjs";
import { hasOwnText, marked, titleHtml } from "#frame/search/rows.mjs";

// The shared window's markup. Its first svg is the source's glyph.
export function createDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "search";
  dialog.id = "search-dialog";
  dialog.innerHTML = `
    <div class="search-left">
      <div class="search-top">
        <svg></svg>
        <input class="search-input" type="search" role="combobox" aria-expanded="true" aria-controls="search-list" aria-autocomplete="list" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" />
        <output class="search-count"></output>
      </div>
      <div class="search-filters"></div>
      <div class="search-list" id="search-list" role="listbox" tabindex="-1"></div>
    </div>
    <aside class="search-preview">
      <div class="search-preview-head" hidden>
        <div class="search-session"></div>
        <div class="search-place"></div>
        <div class="search-actions">
          <button class="btn search-mark" type="button" hidden></button>
          <button class="btn search-open" type="button">Open <kbd>↵</kbd></button>
        </div>
      </div>
      <div class="search-preview-main"><div class="search-words"></div></div>
    </aside>`;
  const close = $("close-button").content.firstElementChild.cloneNode(true);
  close.classList.add("search-close");
  dialog.append(close);
  document.body.append(dialog);
  return dialog;
}

// The body of the preview pane: the row's heading and text, its words marked.
export function showPreview(pane, row, empty = "") {
  pane.innerHTML = row
    ? `<h3>${titleHtml(row)}</h3>${hasOwnText(row) ? `<div class="search-text${row.code ? " is-code" : ""}">${marked(row.text, row.ranges)}</div>` : ""}`
    : empty;
  pane
    .querySelector(".search-text mark")
    ?.scrollIntoView({ block: "center", behavior: "instant" });
}
