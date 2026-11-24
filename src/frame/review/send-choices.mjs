import { unsentItems } from "#frame/app/store.mjs";

/* openSend selects the first choice of each list, and Build it is always
   last, so the popup never opens with Build it selected. */
const choices = {
  round: [
    {
      next: "iterate",
      label: "Keep iterating",
      hint: "This session's agent takes what you send into the next pages.",
    },
    {
      next: "plan",
      label: "Write a plan",
      hint: "This session's agent writes a plan you can build from.",
    },
    {
      next: "build",
      label: "Build it",
      hint: "This session's agent builds what Agreed says.",
    },
  ],
  plan: [
    {
      next: "plan",
      label: "Update the plan",
      hint: "This session's agent revises the plan with what you send.",
    },
    {
      next: "iterate",
      label: "Back to iterating",
      hint: "This session's agent sets the plan aside and keeps exploring.",
    },
    {
      next: "build",
      label: "Build it",
      hint: "This session's agent builds this plan.",
    },
  ],
};

export const choicesFor = (planRound) => choices[planRound ? "plan" : "round"];

export const choiceLabel = (next, planRound) =>
  choicesFor(planRound).find((item) => item.next === next)?.label;

export const startingChoice = (planRound) => choicesFor(planRound)[0].next;

export const nothingToSend = (draft, next, planRound) =>
  unsentItems(draft).count === 0 &&
  !draft.alignUnflagged &&
  !draft.message?.trim() &&
  next === startingChoice(planRound);

function submitText({ inFlight, opensFeedback, pending }) {
  if (inFlight) return "Sending";
  if (opensFeedback) return "What you sent";
  return pending ? `Send (${pending})` : "Send";
}

export function submitButton({
  inFlight,
  opensFeedback,
  onSentFeedback,
  waitingForPages,
  sendable,
  pending,
}) {
  return {
    disabled:
      inFlight ||
      (opensFeedback ? onSentFeedback : waitingForPages || !sendable),
    text: submitText({ inFlight, opensFeedback, pending }),
    primary: !opensFeedback && !waitingForPages,
  };
}
