import { $ } from "#frame/app/util.mjs";

export function tag(text, tone = "") {
  const element = document.createElement("span");
  element.className = `tag ${tone}`.trim();
  element.textContent = text;
  return element;
}

export function linkButton(text, onclick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-btn";
  button.textContent = text;
  button.addEventListener("click", onclick);
  return button;
}

export function separator() {
  const divider = document.createElement("div");
  divider.className = "separator";
  divider.setAttribute("role", "separator");
  return divider;
}

export function pageIndicator(state) {
  const indicator = document.createElement("span");
  indicator.className = `page-activity ${state}`;
  indicator.setAttribute("aria-hidden", "true");
  if (state !== "active") {
    indicator.innerHTML =
      state === "complete"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
  }
  return indicator;
}

export function badge(count) {
  const row = $("review-row");
  if (!row) return;
  const mark = row.querySelector(".count");
  mark.textContent = count ? `(${count})` : "";
  mark.hidden = !count;
}

const fields =
  "textarea, input:is([type=text], [type=search], :not([type])), [contenteditable], iframe, video, audio";
// A video keeps its place only while the page keeps its element.
const started = (media) =>
  !media.paused || (media.currentTime > 0 && !media.ended);

export const fieldHasFocus = () =>
  Boolean(document.activeElement?.matches(fields));

export const inUse = () =>
  Boolean(document.querySelector("dialog:modal, #reading :active")) ||
  (document.hasFocus() && fieldHasFocus()) ||
  [...document.querySelectorAll("video, audio")].some(started);

export function checkRow(items, chosen) {
  for (const row of items) {
    row.setAttribute("aria-checked", String(row === chosen));
    row.classList.toggle("current", row === chosen);
    row.tabIndex = row === chosen ? 0 : -1;
  }
}

export function arrowKeys(group, { rows: getRows, chosen, choose }) {
  group.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[
      event.key
    ];
    if (!step) return;
    event.preventDefault();
    const open = getRows().filter((row) => !row.disabled);
    const index = open.indexOf(chosen());
    const next = open[(index + step + open.length) % open.length];
    choose(next);
    next.focus();
  });
}

// lineButton puts the tooltip inside the button, so hover and focus show it
// and the pointer can rest on it.
export function lineButton({ key, label, content, onClick, tip = null }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn";
  button.dataset.key = key;
  button.setAttribute("aria-label", label);
  button.innerHTML = content;
  if (tip) {
    const text = document.createElement("span");
    text.className = "line-tip";
    text.setAttribute("aria-hidden", "true");
    text.textContent = tip;
    button.append(text);
  }
  button.addEventListener("click", () => onClick(button));
  return button;
}

/* redraw replaces a list only when its HTML changed, and it keeps focus on
   the same row or button, so Tab and Enter work in a list that the poll
   refreshes every few seconds. When the focused button is gone, such as a
   cleared event's, focus moves to the element at the same place. */
export function redraw(list, lines) {
  const next = document.createElement("div");
  next.append(...lines);
  if (next.innerHTML === list.innerHTML) return;
  const keyed = () => [...list.querySelectorAll("[data-key]")];
  const focused = keyed().indexOf(document.activeElement);
  const key = document.activeElement?.dataset.key;
  list.replaceChildren(...next.childNodes);
  if (focused < 0) return;
  const now = keyed();
  (
    now.find((element) => element.dataset.key === key) ||
    now.at(focused) ||
    now.at(-1)
  )?.focus();
}
