/* Above 720px a status card opens with its parts listed, and at 720px and
   below it starts folded. A card the reviewer opens or folds stays that way
   until the page reloads, because toggled exists only in memory. */

const toggled = new Map();
let wide = null;
function wideWindow() {
  if (wide) return wide;
  wide = matchMedia("(min-width: 721px)");
  wide.addEventListener("change", () => {
    for (const box of document.querySelectorAll("details.proposal-status"))
      if (!toggled.has(box.dataset.status)) box.open = wide.matches;
  });
  return wide;
}

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const marks = {
  done: '<path d="M3.5 8.5l3 3 6-7"/>',
  left: '<circle cx="8" cy="8" r="5.2"/>',
  dropped: '<path d="M4 8h8"/>',
  fold: '<path d="M4 6l4 4 4-4"/>',
};
function mark(name, label) {
  const box = element("span", `status-mark ${name}`);
  box.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${marks[name]}</svg>`;
  if (label) {
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", label);
  } else box.setAttribute("aria-hidden", "true");
  return box;
}
const labels = { done: "Done", left: "Left", dropped: "Dropped" };
function part({ text, state }) {
  const item = element("li", state);
  item.append(
    mark(state, labels[state]),
    element(state === "dropped" ? "s" : "span", "", text),
  );
  return item;
}

export function statusBox(card) {
  if (!card.status)
    return element(
      "p",
      "proposal-status empty",
      "No status from the agent yet",
    );
  const { parts } = card.status;
  const counted = parts.filter((item) => item.state !== "dropped");
  const done = counted.filter((item) => item.state === "done");
  const next = parts.find((item) => item.state === "left");
  const box = element("details", "proposal-status");
  box.dataset.status = card.id;
  box.open = toggled.get(card.id) ?? wideWindow().matches;
  const summary = element("summary");
  summary.append(element("b", "", `${done.length} of ${counted.length} done`));
  if (next)
    summary.append(
      element("span", "status-sep", "·"),
      element("span", "status-next", `Next: ${next.text}`),
    );
  summary.append(mark("fold"));
  // The browser toggles the details element after this handler runs, so
  // !box.open is the state after the click.
  summary.addEventListener("click", () => toggled.set(card.id, !box.open));
  const list = element("ul");
  list.append(...parts.map(part));
  box.append(summary, list);
  return box;
}
