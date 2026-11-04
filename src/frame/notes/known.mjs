import { controlKey, normalize } from "#frame/app/util.mjs";
import { agreedTask, agreements, pages } from "#frame/app/view.mjs";
import { pageTargets } from "#frame/notes/controls.mjs";

/* known lists the choices, checklists, questions and text of the round's
   pages, so Review can tell which draft items no longer match a page. */
export const known = {
  choices: new Set(),
  lists: new Set(),
  questions: new Set(),
  text: new Map(),
};
export function indexPage(topic) {
  const template = document.createElement("template");
  template.innerHTML = topic.html;
  pageTargets(template.content, topic.id);
  for (const group of template.content.querySelectorAll("[data-choice]"))
    known.choices.add(controlKey(topic.id, group.dataset.choice));
  for (const group of template.content.querySelectorAll("[data-multiselect]"))
    known.lists.add(controlKey(topic.id, group.dataset.multiselect));
  for (const group of template.content.querySelectorAll("[data-question]"))
    known.questions.add(controlKey(topic.id, group.dataset.question));
  for (const group of template.content.querySelectorAll(
    "[data-drawing-question]",
  ))
    known.questions.add(controlKey(topic.id, group.dataset.drawingQuestion));
  const text = [template.content.textContent];
  for (const source of template.content.querySelectorAll(
    "textarea[data-diff-input]",
  )) {
    try {
      const input = JSON.parse(source.value);
      if (typeof input.before === "string") text.push(input.before);
      if (typeof input.after === "string") text.push(input.after);
    } catch {
      // The builder reports malformed diff input when it builds the page,
      // so indexPage skips it here.
    }
  }
  known.text.set(topic.id, normalize(text.join("\n")));
}
export function rebuildKnown() {
  known.choices.clear();
  known.lists.clear();
  known.questions.clear();
  known.text.clear();
  for (const topic of pages.filter(
    (item) => item.id !== "agreed" && !item.pending,
  ))
    indexPage(topic);
}
export function stale(kind, key, item) {
  if (kind === "note") {
    // Every round has Review's overall comment and Work, so a note on either
    // is never stale.
    if (item.topic === "overall" || item.topic === "work") return false;
    if (item.topic === "agreed")
      return Boolean(
        item.agreementId &&
        !(item.agreementId === "task" && agreedTask) &&
        !agreements.some((entry) => entry.id === item.agreementId),
      );
    if (!known.text.has(item.topic))
      return !pages.some((entry) => entry.id === item.topic && entry.pending);
    return (
      Boolean(item.quote) &&
      !known.text.get(item.topic).includes(normalize(item.quote))
    );
  }
  if (pages.some((entry) => entry.id === item.topic && entry.pending))
    return false;
  if (kind === "answer") return !known.questions.has(key);
  if (kind === "list") return !known.lists.has(key);
  return !known.choices.has(key);
}
