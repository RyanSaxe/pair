import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomic, read, requireValue, timestamp } from "../../shared/util.mjs";

// The agent names each proposal with a slug, such as phone-sidebar.
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Where the work runs once it starts: in this session's rounds, or in a
// session linked to this one, which this session's holder or a separate
// agent creates with pair start --from.
const places = ["here", "sub-session", "new-agent"];
const limits = {
  title: 80,
  delivers: 400,
  changes: 400,
  reason: 400,
  source: 200,
};
const written = ["title", "delivers", "changes", "reason"];
const actions = ["revise", "done", "reopen"];

function words(data, name) {
  const value = typeof data[name] === "string" ? data[name].trim() : "";
  requireValue(
    value && value.length <= limits[name],
    `--${name} takes text of at most ${limits[name]} characters`,
  );
  return value;
}
function place(value, name) {
  requireValue(
    places.includes(value),
    `${name} takes here, sub-session or new-agent`,
  );
  return value;
}
// The reviewer's optional message with Start, at most 4,000 characters as
// an overall comment is.
function message(data) {
  if (data?.message === undefined) return "";
  requireValue(typeof data.message === "string", "A message must be text");
  const text = data.message.trim();
  requireValue(text.length <= 4000, "The message exceeds 4,000 characters");
  return text;
}

// Proposals: one card for each piece of work the agent proposes, from pair
// propose until the work is done. Each card is a file in proposals/, because
// a card changes after the round that showed it is published. Four facts,
// each null until it happens, say where a card stands: plan, started,
// declined and done. The frame sorts the cards into the Work page's tabs
// from those facts, so the hub stores no tab.
export async function proposals(session) {
  const { directory, transition } = session;
  const folder = path.join(directory, "proposals");
  const cards = new Map();
  try {
    for (const name of (await fs.readdir(folder)).sort())
      if (name.endsWith(".json")) {
        const card = await read(path.join(folder, name));
        cards.set(card.id, card);
      }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const proposalItems = () =>
    [...cards.values()].sort((a, b) =>
      a.recordedAt.localeCompare(b.recordedAt),
    );
  async function save(card, patch = {}) {
    const next = { ...card, ...patch, updatedAt: timestamp() };
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    await atomic(path.join(folder, `${next.id}.json`), next);
    cards.set(next.id, next);
    return next;
  }
  function find(id) {
    const card = cards.get(id);
    requireValue(card, `No proposal ${id} in this session`, 404);
    return card;
  }
  function open() {
    requireValue(
      session.state.stage !== "complete",
      "This session is closed",
      409,
    );
  }
  // Where the work came from: a thread, or a page of a round.
  function link(data) {
    requireValue(
      data.thread === undefined || data.page === undefined,
      "pair propose takes --thread or --page, not both",
    );
    if (data.thread !== undefined) {
      requireValue(
        session.threadView().some((thread) => thread.id === data.thread),
        `No thread ${data.thread} in this session`,
      );
      return { thread: data.thread };
    }
    if (data.page === undefined) return {};
    const [round, id, extra] = String(data.page).split("/");
    const set = session.state.roundPages?.[round];
    requireValue(
      round && id && extra === undefined,
      "--page takes ROUND/PAGE, such as 14/commenting",
    );
    requireValue(
      set && (id === "agreed" || set.pages.some((slot) => slot.id === id)),
      `Round ${round} has no page ${id}`,
    );
    return { page: { round, id } };
  }
  function source(data) {
    requireValue(
      data.source !== undefined ||
        (data.thread === undefined && data.page === undefined),
      "--thread and --page go with --source",
    );
    return { text: words(data, "source"), ...link(data) };
  }
  async function add(id, data) {
    requireValue(
      !cards.has(id),
      `This session already has proposal ${id}. Change it with --revise, or give a new proposal its own --id.`,
      409,
    );
    const now = timestamp();
    const card = await save({
      id,
      ...Object.fromEntries(written.map((name) => [name, words(data, name)])),
      recommend: place(data.recommend, "--recommend"),
      source: source(data),
      recordedAt: now,
      plan: null,
      started: null,
      declined: null,
      done: null,
    });
    // Every pair tab's bell announces the card.
    await session.addActivity({
      kind: "proposal",
      name: card.title,
      proposal: id,
      page: "work",
      target: `proposal-${id}`,
    });
    return card;
  }
  // A revision replaces the fields given and keeps the rest.
  async function revise(card, data) {
    requireValue(
      !card.started,
      `Proposal ${card.id} was started, which approved what it said, so it takes no --revise. Record any further change as a new proposal.`,
      409,
    );
    requireValue(
      !card.declined,
      `The reviewer declined proposal ${card.id}. Drop it and do not propose it again.`,
      409,
    );
    const patch = Object.fromEntries(
      written
        .filter((name) => data[name] !== undefined)
        .map((name) => [name, words(data, name)]),
    );
    if (data.recommend !== undefined)
      patch.recommend = place(data.recommend, "--recommend");
    if ([data.source, data.thread, data.page].some((v) => v !== undefined))
      patch.source = source(data);
    requireValue(
      Object.keys(patch).length,
      "--revise takes a field to change: --title, --delivers, --changes, --recommend, --reason or --source",
    );
    return save(card, patch);
  }
  // Start, from the reviewer's button. Work here or in
  // a sub-session saves a Start event, which the agent reads with pair read.
  // When the round waits for the reviewer, a Start here answers it as a
  // submission does, so every pair tab shows the agent's progress on the
  // work. Work with a new agent saves no event, because a separate agent
  // runs pair start --from for it.
  async function start(card, started) {
    open();
    requireValue(
      !card.declined,
      `The reviewer declined proposal ${card.id}`,
      409,
    );
    requireValue(!card.done, `Proposal ${card.id} is done`, 409);
    requireValue(!card.started, `Proposal ${card.id} was already started`, 409);
    const round = session.state.current?.round ?? null;
    const changed = await save(card, {
      started: { at: timestamp(), round, ...started },
    });
    if (started.where === "new-agent") return changed;
    const event = await session.saveEvent({
      id: crypto.randomUUID(),
      intent: "start",
      proposal: card.id,
      where: started.where,
      round,
      by: started.by,
      ...(started.message ? { message: started.message } : {}),
    });
    if (started.where === "here" && session.needsYou())
      await transition({
        stage: "submitted",
        latestSubmissionId: event.id,
        latestSubmissionRound: round,
        roundStartedAt: event.receivedAt,
        wake: session.state.wake ? { ...session.state.wake, last: null } : null,
        takeover: null,
      });
    return changed;
  }
  // Runs after the reviewer's request is answered, as the wake after a
  // submission does.
  async function wakeFor(id) {
    const card = find(id);
    const note = card.started.message
      ? `\n\nThe reviewer's message with Start, which pair read prints too:\n${card.started.message}`
      : "";
    const place =
      card.started.where === "here"
        ? `here in session ${directory}`
        : `in a sub-session of session ${directory}`;
    const line = `pair: the reviewer started proposal ${id}, "${card.title}", ${place}. Run first: pair read --session-dir ${directory}. It prints the start and the next step.${note}`;
    const last = await session.sendWake(line);
    if (session.wake)
      await transition({ wake: { harness: session.wake.harness, last } });
  }
  const listed = () => ({ proposals: proposalItems() });
  // The Start button on a card, with where the work runs and the reviewer's
  // optional message. With a new agent, the answer carries the command the
  // reviewer pastes into that agent, and the hub wakes no one.
  async function startProposal(id, data) {
    const text = message(data);
    const where = place(data?.where, "Start's where");
    await start(find(id), {
      where,
      by: "reviewer",
      ...(text ? { message: text } : {}),
    });
    if (where === "new-agent") return { ...listed(), command: fromCommand(id) };
    if (session.wake && !session.state.paused)
      setTimeout(() => session.exclusive(() => wakeFor(id)), 0);
    return listed();
  }
  const fromCommand = (id) => `pair start --from ${directory} --proposal ${id}`;
  // Open a new agent session on a card asks this session's holder, in a
  // thread on the card, to open a separate agent that runs pair start
  // --from. It starts the card with a new agent when it is not started.
  async function openAgent(id, data) {
    open();
    const card = find(id);
    const text = message(data);
    if (!card.started)
      await start(card, {
        where: "new-agent",
        by: "reviewer",
        ...(text ? { message: text } : {}),
      });
    else
      requireValue(
        card.started.where === "new-agent" && !card.started.session,
        card.started.session
          ? `Proposal ${id} already runs in session ${card.started.session.dir}`
          : `Proposal ${id} was already started`,
        409,
      );
    const thread = await session.agentThread(
      find(id),
      text || "Open a new agent session for this proposal.",
    );
    return { ...listed(), thread };
  }
  // Decline takes a card out of Proposed, and Restore puts it back. Both
  // leave a card already in that state as it is.
  async function declineProposal(id) {
    open();
    const card = find(id);
    requireValue(
      !card.started,
      `Proposal ${id} was started, so it cannot be declined`,
      409,
    );
    if (!card.declined) await save(card, { declined: { at: timestamp() } });
    return listed();
  }
  async function restoreProposal(id) {
    open();
    const card = find(id);
    if (card.declined) await save(card, { declined: null });
    return listed();
  }
  // Work started here is done when the agent says so, and feedback that asks
  // for changes to it reopens it. Closing a linked session marks the card of
  // work started anywhere else.
  function startedHere(card, flag) {
    requireValue(
      card.started?.where === "here",
      card.started
        ? `Proposal ${card.id} runs in a ${card.started.where === "new-agent" ? "new agent's session" : "sub-session"}, so closing that session marks it done, and it takes no --${flag}.`
        : `Proposal ${card.id} has not been started, so it takes no --${flag}.`,
      409,
    );
  }
  async function done(card) {
    startedHere(card, "done");
    requireValue(!card.done, `Proposal ${card.id} is already done`, 409);
    return save(card, {
      done: {
        at: timestamp(),
        by: "agent",
        round: session.state.current?.round ?? null,
      },
    });
  }
  async function reopen(card) {
    startedHere(card, "reopen");
    requireValue(card.done, `Proposal ${card.id} is not done`, 409);
    return save(card, { done: null });
  }
  // pair propose, from any agent: it records a card, or with one action
  // flag changes the card that has the ID.
  async function propose(data) {
    open();
    const id = typeof data.id === "string" ? data.id : "";
    requireValue(
      slug.test(id) && id.length <= 60,
      "--id takes a slug of lowercase letters, digits and hyphens, at most 60 characters, such as phone-sidebar",
    );
    const chosen = actions.filter((name) => data[name] !== undefined);
    requireValue(
      chosen.length <= 1,
      "pair propose takes one of --revise, --done and --reopen",
    );
    const [action] = chosen;
    if (!action) return add(id, data);
    const card = find(id);
    if (action === "revise") return revise(card, data);
    const fields = [...written, "recommend"].filter(
      (name) => data[name] !== undefined,
    );
    requireValue(
      !fields.length,
      `--${action} changes no field. Run --revise for --${fields[0]}.`,
    );
    if (action === "done") return done(card);
    return reopen(card);
  }
  // pair plan attaches a plan to a card that is neither declined nor done,
  // started or not, and a second pair plan replaces it.
  function plannable(id) {
    open();
    const card = find(id);
    requireValue(
      !card.declined,
      `The reviewer declined proposal ${id}, so it takes no plan`,
      409,
    );
    requireValue(
      !card.done,
      `Proposal ${id} is done, so it takes no plan`,
      409,
    );
    return card;
  }
  const attachPlan = (id, plan) => save(plannable(id), { plan });
  // pair read prints each card the reviewer declined once, and the hub
  // sends no wake for a decline.
  async function reportDeclined() {
    const unreported = proposalItems().filter(
      (card) => card.declined && !card.declined.reported,
    );
    for (const card of unreported)
      await save(card, {
        declined: { ...card.declined, reported: timestamp() },
      });
    return unreported;
  }
  // pair start --from links one session to a card the reviewer started in
  // a sub-session or with a new agent. Starting the card is the reviewer's
  // instruction, so a card nobody started links to no session.
  function linkable(id) {
    open();
    const card = find(id);
    requireValue(
      !card.started?.session,
      `Proposal ${id} is already linked to session ${card.started?.session?.dir}`,
      409,
    );
    requireValue(
      card.started && card.started.where !== "here",
      card.started
        ? `Proposal ${id} was started here, so it runs in this session's rounds`
        : `The reviewer has not started proposal ${id}. pair start --from runs a proposal started in a sub-session or with a new agent.`,
      409,
    );
    return card;
  }
  const linkSession = (id, linked) => {
    const card = linkable(id);
    return save(card, { started: { ...card.started, session: linked } });
  };
  // Closing a linked session marks its card done, once.
  async function closedSession(id, sessionId) {
    const card = cards.get(id);
    if (!card || card.done || card.started?.session?.id !== sessionId) return;
    await save(card, { done: { at: timestamp(), by: "close" } });
  }
  // pair read prints each card whose linked session closed once, and the
  // hub sends no wake for it.
  async function reportClosed() {
    const unreported = proposalItems().filter(
      (card) => card.done?.by === "close" && !card.done.reported,
    );
    for (const card of unreported)
      await save(card, { done: { ...card.done, reported: timestamp() } });
    return unreported;
  }
  return {
    proposalItems,
    reportDeclined,
    reportClosed,
    linkable,
    linkSession,
    closedSession,
    openAgent,
    propose,
    plannable,
    attachPlan,
    startProposal,
    declineProposal,
    restoreProposal,
  };
}
