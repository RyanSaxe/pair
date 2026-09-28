import { persist, save, state } from "#frame/app/store.mjs";
import { $, controlKey } from "#frame/app/util.mjs";
import { editable, feedbackEditable, page, plan } from "#frame/app/view.mjs";

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
export function restoreAnswers() {
  document.querySelectorAll("[data-question] textarea").forEach((area) => {
    const group = area.closest("[data-question]");
    const key = controlKey(page.id, group.dataset.question);
    area.value = state.drafts[key] ?? state.answers[key]?.text ?? "";
    area.readOnly = !editable;
  });
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
}
export function drawingAnswer(id) {
  return state.answers[controlKey(page.id, id)];
}
