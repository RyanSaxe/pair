/* The status of approved work on its card: how many of its parts the agent
   has finished, the next part, and every part, each with a check when done
   or an empty circle when left. Wider than 720px a card opens with its
   parts listed. Narrower, it shows the count and the next part until the
   reviewer taps it. A card the reviewer opens or folds stays that way
   until the page reloads. */

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
function part(text, done) {
  const item = element("li", done ? "done" : "left");
  item.append(
    mark(done ? "done" : "left", done ? "Done" : "Left"),
    element("span", "", text),
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
  const { done, left } = card.status;
  const box = element("details", "proposal-status");
  box.dataset.status = card.id;
  box.open = toggled.get(card.id) ?? wideWindow().matches;
  const summary = element("summary");
  summary.append(
    element("b", "", `${done.length} of ${done.length + left.length} done`),
  );
  if (left.length)
    summary.append(
      element("span", "status-sep", "·"),
      element("span", "status-next", `Next: ${left[0]}`),
    );
  summary.append(mark("fold"));
  // A click on the summary toggles the box after this runs.
  summary.addEventListener("click", () => toggled.set(card.id, !box.open));
  const list = element("ul");
  list.append(
    ...done.map((text) => part(text, true)),
    ...left.map((text) => part(text, false)),
  );
  box.append(summary, list);
  return box;
}
