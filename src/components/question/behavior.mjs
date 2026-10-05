/* The Answer button and the answered card. planUI.prefs keeps the state for
   this session and round, so a reload comes back answered. */
planUI.define("question", {
  match: ".question[data-question]",
  setup(card, { page, planUI }) {
    const area = card.querySelector("textarea");
    const text = card.querySelector(".answer-text");
    const save = card.querySelector("[data-answer]");
    const edit = card.querySelector("[data-edit]");
    if (!area || !text || !save || !edit) return;
    const key = `answered:${page.id}/${card.dataset.question}`;
    const show = (answered) => {
      card.dataset.state = answered ? "answered" : "open";
      text.textContent = area.value;
      text.hidden = !answered;
      area.hidden = answered;
      save.hidden = answered;
      edit.hidden = !answered;
    };
    // Shift+Enter in the box presses Answer, and the button shows the key.
    // The hint is added here rather than in the markup, so a page whose
    // author copied the markup before it had the hint shows it too.
    if (!save.querySelector("kbd")) {
      const hint = document.createElement("kbd");
      hint.textContent = "⇧ ↵";
      save.append(hint);
    }
    save.disabled = !area.value.trim();
    area.addEventListener("input", () => {
      save.disabled = !area.value.trim();
    });
    save.onclick = () => {
      planUI.answer(
        card.dataset.question,
        area.value,
        card.dataset.label,
        card.id,
      );
      planUI.prefs.set(key, "1");
      show(true);
    };
    edit.onclick = () => {
      planUI.prefs.set(key, "");
      show(false);
      area.focus();
    };
    // The card shows as answered only while the draft has an answer for the
    // question. A new round's draft has no answer that was sent.
    if (
      planUI.prefs.get(key) &&
      planUI.answered(card.dataset.question) &&
      area.value.trim()
    )
      show(true);
  },
});
