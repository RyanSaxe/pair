// Finish your review on a round with an offer. The round's entry in the
// registry fills the Accept row, the hint under Request changes, and the
// Accept section: its note, the guidance field's label and hint, and one
// button per action, plain ones on the left and the primary one on the right.
export function renderFinish(document, round, registry, accept) {
  const $ = (id) => document.getElementById(id);
  const offer = registry[round.offer];
  const text = {
    "finish-detail": `${round.title}, round ${round.round}`,
    "accept-label": offer.accept.label,
    "accept-hint": offer.accept.hint,
    "changes-hint": offer.changes,
    "accept-note": offer.accept.note,
    "accept-guidance-label": offer.accept.guidance.label,
    "accept-guidance-detail": offer.accept.guidance.hint,
  };
  for (const [id, value] of Object.entries(text)) $(id).textContent = value;
  $("accept-actions").replaceChildren(
    ...offer.accept.actions.map((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.primary ? "btn primary" : "btn";
      button.textContent = action.label;
      button.onclick = () => accept(action);
      return button;
    }),
  );
}
