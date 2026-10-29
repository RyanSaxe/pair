import { normalize } from "#frame/app/util.mjs";

/* diagramBox() returns the ID that Pele gives the box node is in, and the
   box's label. Pele wraps a label over several lines, and diagramBox()
   joins them with spaces. It returns null for a box with no label, such as
   a state diagram's start. */
export function diagramBox(node) {
  const at = node?.nodeType === 1 ? node : node?.parentElement;
  const box = at?.closest(".pele-node[data-id]");
  const label = box?.querySelector(".pele-label");
  if (!label) return null;
  const lines = label.querySelectorAll("tspan");
  const text = normalize(
    lines.length
      ? [...lines].map((line) => line.textContent).join(" ")
      : label.textContent,
  );
  return text ? { id: box.dataset.id, label: text } : null;
}
// diagramBoxes() can return more than one box for an ID, because a sequence
// diagram draws each participant at the top and the bottom.
export function diagramBoxes(target, id) {
  const host = target && document.getElementById(target);
  if (!host) return [];
  const hosts = host.matches("[data-diagram]")
    ? [host]
    : host.querySelectorAll("[data-diagram]");
  return [...hosts].flatMap((diagram) => [
    ...diagram.querySelectorAll(`.pele-node[data-id="${CSS.escape(id)}"]`),
  ]);
}
