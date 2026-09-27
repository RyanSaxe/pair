// An action's `after` is what the session does once the reviewer accepts
// with it: it is saved until an agent runs its handoff line, it goes on to
// the agent's next round, or it completes when the agent has done the
// action.
export const offers = {
  plan: {
    firstPage: "overview",
    accept: {
      label: "Accept plan",
      hint: "Save it for later, or start implementation now.",
      note: "Starting implementation hands the plan to the waiting agent. Saving keeps it for later and the agent stops.",
      guidance: {
        label: "Implementation guidance, optional",
        hint: "Sent only with Start implementation.",
        action: "implement",
      },
      actions: [
        { id: "save", label: "Save for later", after: "saved" },
        {
          id: "implement",
          label: "Start implementation",
          primary: true,
          after: "round",
        },
      ],
    },
    changes: "The agent revises the plan and publishes a new round.",
    guide: "guide/offers/plan.md",
  },
  finish: {
    accept: {
      label: "Accept work",
      hint: "Open a PR, or finish with the work on its branch.",
      note: "Open a PR uses the last page as its description. The work stays committed on its branch either way.",
      guidance: {
        label: "PR guidance, optional",
        hint: "Sent only with Open a PR.",
        action: "pull-request",
      },
      actions: [
        { id: "finish", label: "Finish without a PR", after: "complete" },
        {
          id: "pull-request",
          label: "Open a PR",
          primary: true,
          after: "complete",
        },
      ],
    },
    changes: "The agent changes the work and publishes a new round.",
    guide: "guide/offers/finish.md",
  },
};
