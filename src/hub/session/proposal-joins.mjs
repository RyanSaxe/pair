import { requireValue } from "../../shared/util.mjs";

// pair propose --id X --join TASK merges X, a card nobody has started, into
// TASK, a card whose work covers it that is proposed or started here. The
// agent that builds TASK reads its joined cards when the work starts, with
// the Start in pair read or in pair start --from, so TASK may not already
// run in a linked session. No card joins itself or a joined card.
// joinable refuses every other pair of cards before the hub changes one.
export function joinable(card, task) {
  requireValue(
    !card.declined,
    `The reviewer declined proposal ${card.id}. Drop it and do not propose it again.`,
    409,
  );
  requireValue(
    !card.started && !card.done && !card.withdrawn,
    `Proposal ${card.id} ${card.withdrawn ? "was withdrawn" : card.done?.joined ? `already joined ${card.done.joined}` : card.done ? "is done" : "was started"}, so it takes no --join.`,
    409,
  );
  requireValue(
    task.id !== card.id,
    `Proposal ${card.id} cannot join itself. --join takes another proposal whose work covers it.`,
  );
  const into = task.done?.joined;
  const instead =
    into === card.id ? "" : ` Join proposal ${card.id} into ${into}.`;
  requireValue(
    !into,
    `Proposal ${task.id} already joined ${into}, so no proposal can join it.${instead}`,
    409,
  );
  const closed = task.declined
    ? `The reviewer declined proposal ${task.id}`
    : `Proposal ${task.id} ${task.withdrawn ? "was withdrawn" : "is done"}`;
  requireValue(
    !task.declined && !task.withdrawn && !task.done,
    `${closed}, so no proposal can join it.`,
    409,
  );
  requireValue(
    !task.started || task.started.where === "here",
    `Proposal ${task.id} runs in ${task.started?.where === "new-agent" ? "a new agent's session" : "a sub-session"}, so no proposal can join it.`,
    409,
  );
}
