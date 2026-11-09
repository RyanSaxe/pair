import { requireValue } from "../../shared/util.mjs";
import { refuse } from "./proposal-fields.mjs";

// pair propose --id X --join OTHER merges X, a card nobody has started, into
// OTHER, a proposed card or one started here whose work covers X. The agent
// that builds OTHER reads its joined cards when the work starts, with the
// Start in pair read or in pair start --from, so OTHER cannot already run in
// a linked session. No card joins itself or a joined card. joinable refuses
// any other pair of cards before the hub changes either one.
export function joinable(card, task) {
  const cannot = (reason) =>
    `${reason}, so you cannot join it into another proposal.`;
  refuse(card, "join", {
    declined: `The reviewer declined proposal ${card.id}. Drop its work and do not suggest it again.`,
    withdrawn: cannot(`Proposal ${card.id} is withdrawn`),
    joined: cannot(
      `Proposal ${card.id} is already joined into ${card.done?.joined}`,
    ),
    finished: cannot(`Proposal ${card.id} is marked done`),
    started: cannot(`The reviewer approved proposal ${card.id}`),
  });
  requireValue(
    task.id !== card.id,
    `Proposal ${card.id} cannot join itself. --join takes another proposal whose work covers it.`,
  );
  const into = task.done?.joined;
  const instead =
    into === card.id ? "" : ` Join proposal ${card.id} into ${into}.`;
  const elsewhere = `Proposal ${task.id} runs in ${task.started?.where === "new-agent" ? "a new agent's session" : "a sub-session"}, so no proposal can join it.`;
  refuse(task, "joinInto", {
    joined: `Proposal ${task.id} is joined into ${into}, so no proposal can join it.${instead}`,
    declined: `The reviewer declined proposal ${task.id}, so no proposal can join it.`,
    withdrawn: `Proposal ${task.id} is withdrawn, so no proposal can join it.`,
    finished: `Proposal ${task.id} is marked done, so no proposal can join it.`,
    opening: elsewhere,
    linked: elsewhere,
  });
}
