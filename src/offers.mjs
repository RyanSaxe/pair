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
        { id: "save", label: "Save for later" },
        { id: "implement", label: "Start implementation", primary: true },
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
        { id: "finish", label: "Finish without a PR" },
        { id: "pull-request", label: "Open a PR", primary: true },
      ],
    },
    changes: "The agent changes the work and publishes a new round.",
    guide: "guide/offers/finish.md",
  },
};
