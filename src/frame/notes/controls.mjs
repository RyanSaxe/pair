import { persist, save, state } from "#frame/app/store.mjs";
import { $, controlKey } from "#frame/app/util.mjs";
import {
  editable,
  feedbackEditable,
  page,
  pages,
  plan,
} from "#frame/app/view.mjs";

let answerTimer;
export function choiceTargets(root, topic) {
  for (const type of ["choice", "multiselect", "question"])
    root.querySelectorAll(`[data-${type}]`).forEach((group, index) => {
      group.id ||= `${type}-${topic}-${index}`;
    });
}
function checklist(group, topic, previous) {
  return {
    kind: "multiple",
    topic,
    label: group.dataset.label || group.dataset.multiselect,
    target: group.id,
    round: plan.round,
    touched: previous?.touched === true,
    options: Array.from(
      group.querySelectorAll('input[type="checkbox"][data-value]'),
      (input) => ({
        value: input.dataset.value,
        label: input.dataset.label || input.dataset.value,
        checked:
          previous?.options?.find(
            (option) => option.value === input.dataset.value,
          )?.checked ?? input.checked,
      }),
    ),
  };
}
export function initializeChecklists() {
  const before = JSON.stringify(state.choices);
  for (const topic of plan.pages.filter((item) => !item.pending)) {
    const template = document.createElement("template");
    template.innerHTML = topic.html;
    choiceTargets(template.content, topic.id);
    for (const group of template.content.querySelectorAll(
      "[data-multiselect]",
    )) {
      const id = controlKey(topic.id, group.dataset.multiselect);
      const previous = state.choices[id];
      state.choices[id] = {
        ...checklist(group, topic.id, previous),
        ...(previous?.sentIn ? { sentIn: previous.sentIn } : {}),
      };
    }
  }
  // Saving an unchanged draft would write this tab's copy over one that
  // another tab saved since, such as the copy that marks a send.
  if (JSON.stringify(state.choices) !== before) persist();
}
export function restoreChoices() {
  document.querySelectorAll("[data-choice] [data-value]").forEach((button) => {
    const group = button.closest("[data-choice]");
    button.setAttribute(
      "aria-pressed",
      String(
        state.choices[controlKey(page.id, group.dataset.choice)]?.value ===
          button.dataset.value,
      ),
    );
  });
  document
    .querySelectorAll('[data-multiselect] input[type="checkbox"][data-value]')
    .forEach((input) => {
      const group = input.closest("[data-multiselect]");
      const choice =
        state.choices[controlKey(page.id, group.dataset.multiselect)];
      input.checked =
        choice?.options.find((option) => option.value === input.dataset.value)
          ?.checked ?? input.defaultChecked;
    });
}
// Typed text is sent only once Answer records it, so text that differs
// from the recorded answer is not added.
const notAdded = (key) => {
  const text = state.drafts[key];
  return (
    typeof text === "string" &&
    Boolean(text.trim()) &&
    text !== state.answers[key]?.text
  );
};
// Each question on the page shows "Not added" beside its Answer button
// while its typed text is not added.
function markNotAdded() {
  const show = feedbackEditable();
  document
    .querySelectorAll("#page-content [data-question]")
    .forEach((group) => {
      if (!group.querySelector("textarea")) return;
      let label = group.querySelector(".not-added");
      if (!label) {
        // The Revisiting tag on an alignment in Agreed has the same classes.
        label = document.createElement("span");
        label.className = "tag attention not-added";
        label.textContent = "Not added";
        const actions = group.querySelector(".answer-actions");
        if (actions) actions.append(label);
        else group.querySelector("textarea").after(label);
      }
      label.hidden =
        !show || !notAdded(controlKey(page.id, group.dataset.question));
    });
}
// The questions in Current's round whose typed text is not added, from
// the pages loaded so far.
export function notAddedAnswers() {
  const found = [];
  for (const topic of pages.filter(
    (item) => item.id !== "agreed" && !item.pending,
  )) {
    const template = document.createElement("template");
    template.innerHTML = topic.html;
    choiceTargets(template.content, topic.id);
    for (const group of template.content.querySelectorAll("[data-question]"))
      if (
        group.querySelector("textarea") &&
        notAdded(controlKey(topic.id, group.dataset.question))
      )
        found.push({
          topic: topic.id,
          target: group.id,
          label: group.dataset.label || group.dataset.question,
        });
  }
  return found;
}
// Whether the draft has typed text for a question on the page.
export const typedOn = (topic) =>
  Object.entries(state.drafts).some(
    ([key, text]) => key.startsWith(`${topic}/`) && typeof text === "string",
  );
export function restoreAnswers() {
  document.querySelectorAll("[data-question] textarea").forEach((area) => {
    const group = area.closest("[data-question]");
    const key = controlKey(page.id, group.dataset.question);
    area.value = state.drafts[key] ?? state.answers[key]?.text ?? "";
    area.readOnly = !editable;
  });
  markNotAdded();
}
export function installControls() {
  document.addEventListener("change", (event) => {
    if (!feedbackEditable()) return;
    const input = event.target.closest(
      '[data-multiselect] input[type="checkbox"][data-value]',
    );
    if (!input) return;
    const group = input.closest("[data-multiselect]");
    state.choices[controlKey(page.id, group.dataset.multiselect)] = {
      ...checklist(group, page.id),
      touched: true,
    };
    save();
  });
  document.addEventListener("input", (event) => {
    if (!feedbackEditable()) return;
    const area = event.target.closest("[data-question] textarea");
    if (!area || !$("page-content").contains(area)) return;
    const group = area.closest("[data-question]");
    const key = controlKey(page.id, group.dataset.question);
    if (area.value.trim()) state.drafts[key] = area.value;
    else delete state.drafts[key];
    markNotAdded();
    clearTimeout(answerTimer);
    answerTimer = setTimeout(save, 300);
  });
}
export function recordAnswer(id, text, label, target) {
  if (!feedbackEditable()) return;
  const key = controlKey(page.id, id);
  if (text.trim())
    state.answers[key] = {
      topic: page.id,
      label: label || id,
      text,
      target,
      round: plan.round,
    };
  else delete state.answers[key];
  save();
  markNotAdded();
}
export function drawingAnswer(id) {
  return state.answers[controlKey(page.id, id)];
}
