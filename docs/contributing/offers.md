# Offers

A round can have an offer, which the reviewer accepts in the Finish your
review dialog: `plan` on a complete plan and `finish` on complete work the
agent built. Each entry in `src/shared/offers.mjs` gives the dialog's Accept
row and the hint under Request changes, the page a round must open on when it
names one, and a guide file under `guide/offers/` that says what the agent
does for each action. Each action's `after` says what the session does once
the reviewer accepts with it: Save for later saves it until an agent runs its
handoff line, Start implementation goes on to the build round, and the finish
actions complete it. The build, the hub and the frame all read this registry,
so a new offer is one entry there, one guide file, and its moment texts:
`guide/moments/publish-agreed-OFFER.md`, which `pair publish` prints after
its Agreed, and `guide/moments/read-accept-ACTION.md` for each of its
actions, which `pair read` prints with the acceptance.

The offer is optional and is set only in Agreed's source. A round whose Agreed
names no offer shows Send feedback.
