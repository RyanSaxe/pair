/* The status of approved work on its card: how many of its parts the agent
   has finished, leaving out the parts it dropped, the next part, and every
   part in the order the agent added it, with a check when done, an empty
   circle when left, and a dash and a line through the text when dropped.
   Wider than 720px a card opens with its parts listed. Narrower, it shows
   the count and the next part until the reviewer taps it. A card the
   reviewer opens or folds stays that way until the page reloads. */

const toggled = new Map();
let wide = null;
// Each card the reviewer has not opened or folded follows the window's
// width as it changes.
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
  // A click on the summary toggles the box after this runs.
  summary.addEventListener("click", () => toggled.set(card.id, !box.open));
  const list = element("ul");
  list.append(...parts.map(part));
  box.append(summary, list);
  return box;
}
