import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomic, read, requireValue, timestamp } from "../../shared/util.mjs";
import {
  message,
  place,
  planFirst,
  proposeAction,
  words,
  written,
} from "./proposal-fields.mjs";
import { joinable } from "./proposal-joins.mjs";
import {
  changedParts,
  loadedStatus,
  statusable,
  statusChange,
} from "./proposal-status.mjs";

// Proposals: one card for each piece of work the agent proposes, from pair
// propose until the work is done. Each card is a file in proposals/, because
// a card changes after the round that showed it is published. Four facts,
// each null until it happens, say where a card stands: started, declined,
// withdrawn and done. The frame sorts the cards into the Work page's tabs
// from those facts, so the hub stores no tab.
export async function proposals(session) {
  const { directory, transition } = session;
  const folder = path.join(directory, "proposals");
  const cards = new Map();
  try {
    for (const name of (await fs.readdir(folder)).sort())
      if (name.endsWith(".json")) {
        const card = await read(path.join(folder, name));
        if (card.status) card.status = loadedStatus(card.status);
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
  // Where the work came from: a thread, or a page of a round with the
  // page's title from the round's page list. The reviewer also writes on
  // Review's overall comment and on Work, which every round has.
  const framePages = { overall: "Review", work: "Work" };
  function source(data) {
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
    requireValue(
      round && id && extra === undefined,
      "--page takes ROUND/PAGE, such as 14/commenting",
    );
    const slot =
      session.state.roundPages?.[round] &&
      (Object.hasOwn(framePages, id)
        ? { title: framePages[id] }
        : session.pageSet(round).pages.find((item) => item.id === id));
    requireValue(slot, `Round ${round} has no page ${id}`);
    return { page: { round, id, title: slot.title } };
  }
  async function add(id, data) {
    requireValue(
      !cards.has(id),
      `This session already has proposal ${id}. Edit it with --revise, or give the new proposal its own --id.`,
      409,
    );
    const now = timestamp();
    const card = await save({
      id,
      ...Object.fromEntries(written.map((name) => [name, words(data, name)])),
      recommend: place(data.recommend, "--recommend"),
      source: source(data),
      recordedAt: now,
      started: null,
      declined: null,
      withdrawn: null,
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
      `The reviewer approved proposal ${card.id} as it stands, so you cannot revise it. Record any further work as a new proposal.`,
      409,
    );
    requireValue(
      !card.declined,
      `The reviewer declined proposal ${card.id}. Drop its work and do not suggest it again.`,
      409,
    );
    requireValue(
      !card.withdrawn && !card.done,
      `Proposal ${card.id} is ${card.done ? "marked done" : "withdrawn"}, so you cannot revise it. Record further work as a new proposal.`,
      409,
    );
    const patch = Object.fromEntries(
      written
        .filter((name) => data[name] !== undefined)
        .map((name) => [name, words(data, name)]),
    );
    if (data.recommend !== undefined)
      patch.recommend = place(data.recommend, "--recommend");
    if (data.thread !== undefined || data.page !== undefined)
      patch.source = source(data);
    requireValue(
      Object.keys(patch).length,
      "--revise takes a field to change: --title, --delivers, --recommend, --page or --thread",
    );
    return save(card, patch);
  }
  // Start, from the reviewer's button or from their words. Work here or in
  // a sub-session saves a Start event, which the agent reads with pair
  // read. Work with a new agent saves no event, because a separate agent
  // runs pair start --from for it. A Start leaves the round as it was,
  // wherever the work runs: only the reviewer's feedback answers a round,
  // so a round that waits for them keeps waiting.
  async function start(card, started) {
    open();
    requireValue(
      !card.declined,
      `The reviewer declined proposal ${card.id}`,
      409,
    );
    requireValue(
      !card.withdrawn,
      `Proposal ${card.id} was withdrawn. Record the work as a new proposal.`,
      409,
    );
    requireValue(
      !card.done,
      `Proposal ${card.id} is already marked done.`,
      409,
    );
    requireValue(
      !card.started,
      `Proposal ${card.id} is already approved.`,
      409,
    );
    const round = session.state.current?.round ?? null;
    const changed = await save(card, {
      started: { at: timestamp(), round, ...started },
    });
    if (started.where === "new-agent") return changed;
    await session.saveEvent({
      id: crypto.randomUUID(),
      intent: "start",
      proposal: card.id,
      round,
      ...started,
    });
    return changed;
  }
  // Runs after the request that started the card is answered, as the wake
  // after a submission does.
  async function wakeFor(id) {
    const card = find(id);
    const { started } = card;
    const fromWords = started.by === "words";
    const text = fromWords ? started.quote : started.message;
    const note = text
      ? `\n\nThe reviewer's words, which pair read also prints:\n${text}`
      : "";
    const place =
      started.where === "here"
        ? `in session ${directory}`
        : `in a sub-session of session ${directory}`;
    const what = fromWords
      ? `the reviewer asked for proposal ${id}, "${card.title}", in their own words, to run ${place}`
      : `the reviewer approved proposal ${id}, "${card.title}", to run ${place}`;
    const line = `pair: ${what}. Run pair read --session-dir ${directory} first, which prints what the reviewer approved and your next step.${note}`;
    const last = await session.sendWake(line);
    if (session.wake)
      await transition({ wake: { harness: session.wake.harness, last } });
  }
  const wakeLater = (id) => {
    if (session.wake && !session.state.paused)
      setTimeout(() => session.exclusive(() => wakeFor(id)), 0);
  };
  const listed = () => ({ proposals: proposalItems() });
  // The Start button on a card, with where the work runs and the reviewer's
  // optional message. With a new agent, the answer carries the command the
  // reviewer pastes into that agent, and the hub wakes no one.
  async function startProposal(id, data) {
    const text = message(data);
    const where = place(data?.where, "Start's where");
    const plan = planFirst(data, where);
    await start(find(id), {
      where,
      by: "reviewer",
      ...(text ? { message: text } : {}),
      ...plan,
    });
    if (where === "new-agent") return { ...listed(), command: fromCommand(id) };
    wakeLater(id);
    return listed();
  }
  // pair propose --start: the agent starts a card because the reviewer
  // asked for the work in a note, a thread or the chat, with their words
  // and, when it gives them, where they wrote them. The holder that runs it
  // reads the start with pair read, which its next step names, so the hub
  // wakes the holder only for a start another agent sends.
  async function startFromWords(card, data, holder) {
    const where = place(data.start, "--start");
    requireValue(
      data.quote !== undefined,
      "--start takes --quote with the reviewer's words",
    );
    const started = await start(card, {
      where,
      by: "words",
      quote: words(data, "quote"),
      ...source(data),
    });
    if (!holder && where !== "new-agent") wakeLater(card.id);
    return started;
  }
  const fromCommand = (id) => `pair start --from ${directory} --proposal ${id}`;
  // Open a new agent session on a card asks this session's holder, in a
  // thread on the card, to open a separate agent that runs pair start
  // --from. It starts the card with a new agent when it is not started.
  async function openAgent(id, data) {
    open();
    const card = find(id);
    const text = message(data);
    const plan = planFirst(data, "new-agent");
    if (!card.started)
      await start(card, {
        where: "new-agent",
        by: "reviewer",
        ...(text ? { message: text } : {}),
        ...plan,
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
  // Decline takes a proposed card out of Proposed, and Restore puts a
  // declined or withdrawn card back. Both leave a card already in that
  // state as it is.
  async function declineProposal(id) {
    open();
    const card = find(id);
    requireValue(
      !card.started && !card.done,
      `Proposal ${id} was ${card.done ? "done" : "started"}, so it cannot be declined`,
      409,
    );
    if (!card.declined && !card.withdrawn)
      await save(card, { declined: { at: timestamp() } });
    return listed();
  }
  async function restoreProposal(id) {
    open();
    const card = find(id);
    if (card.declined || card.withdrawn)
      await save(card, { declined: null, withdrawn: null });
    return listed();
  }
  // The agent withdraws a card nobody has started that no longer applies,
  // with its reason. Withdrawn and declined cards are both in Done, and the
  // reviewer's Restore puts either back.
  async function withdraw(card, data) {
    requireValue(
      !card.declined,
      `The reviewer declined proposal ${card.id}. Drop its work and do not suggest it again.`,
      409,
    );
    requireValue(
      !card.started && !card.done && !card.withdrawn,
      card.withdrawn
        ? `Proposal ${card.id} is already withdrawn.`
        : card.done
          ? `Proposal ${card.id} is marked done, so you cannot withdraw it.`
          : `The reviewer approved proposal ${card.id}, so you cannot withdraw it.`,
      409,
    );
    requireValue(
      data.reason !== undefined,
      "--withdraw takes --reason with why the proposal no longer applies",
    );
    return save(card, {
      withdrawn: { at: timestamp(), reason: words(data, "reason") },
    });
  }
  // The agent marks work started here done after its last page. With
  // --where, it marks a card done whose work got done somewhere else,
  // started here or not started. Only closing a linked session marks the
  // card of work started there, so the card keeps its link to that session.
  async function done(card, data) {
    requireValue(
      !card.done,
      `Proposal ${card.id} is already marked done.`,
      409,
    );
    requireValue(
      !card.declined && !card.withdrawn,
      card.declined
        ? `The reviewer declined proposal ${card.id}, so you cannot mark it done.`
        : `Proposal ${card.id} is withdrawn, so you cannot mark it done.`,
      409,
    );
    requireValue(
      !card.started || card.started.where === "here",
      `Proposal ${card.id} runs in ${card.started?.where === "new-agent" ? "a new agent's session" : "a sub-session"}. The hub marks it done when the reviewer closes that session.`,
      409,
    );
    const where = data.where === undefined ? null : words(data, "where");
    requireValue(
      where || card.started,
      `The reviewer has not approved proposal ${card.id}. If its work was finished somewhere else, add --where to say where, such as --where "in #86".`,
      409,
    );
    return save(card, {
      done: {
        at: timestamp(),
        by: "agent",
        round: session.state.current?.round ?? null,
        ...(where ? { where } : {}),
      },
    });
  }
  // The cards the agent joined into a card.
  const joinedInto = (id) =>
    proposalItems().filter((card) => card.done?.joined === id);
  // The agent merges a card nobody has started into OTHER, as
  // proposal-joins.mjs describes. The joined card is done, and its done
  // fact names OTHER. No card joins a joined card, so the cards already
  // joined into the card move to OTHER with it. Every list of a card's
  // joined cards comes from those facts, so finishing or reopening OTHER
  // leaves them joined.
  async function join(card, data) {
    const task = find(data.join);
    joinable(card, task);
    for (const item of joinedInto(card.id))
      await save(item, { done: { ...item.done, joined: task.id } });
    return save(card, {
      done: {
        at: timestamp(),
        by: "agent",
        round: session.state.current?.round ?? null,
        joined: task.id,
      },
    });
  }
  // --reopen undoes the agent's own --done or --join, so the card returns
  // to Running, or to Proposed when nobody started it. It clears the
  // status, because the feedback that reopens work changes its parts.
  async function reopen(card) {
    requireValue(
      card.done,
      `Proposal ${card.id} is not marked done, so there is nothing to reopen.`,
      409,
    );
    requireValue(
      card.done.by === "agent",
      `The hub marked proposal ${card.id} done when the reviewer closed the session that built it, so you cannot reopen it.`,
      409,
    );
    return save(card, { done: null, status: null });
  }
  // A linked session's agent writes the status of the work it runs to the
  // card in the parent. A status that changes no part leaves the card as
  // it was, so status.at is the time of the last change to the parts.
  async function writeStatus(id, data) {
    const owner = session.cardOwner(id, "pair propose");
    if (owner) return owner.exclusive(() => owner.writeStatus(id, data));
    open();
    const change = statusChange(data);
    const card = statusable(find(id));
    const parts = changedParts(card, change);
    if (JSON.stringify(parts) === JSON.stringify(card.status?.parts))
      return card;
    return save(card, { status: { at: timestamp(), parts } });
  }
  // pair propose, from any agent: it records a card, or with one action
  // flag changes the card that has the ID. holder says whether the holder
  // sent it.
  async function propose(data, holder) {
    open();
    const { id, action } = proposeAction(data);
    if (!action) return add(id, data);
    if (action === "status") return writeStatus(id, data);
    const card = find(id);
    if (action === "revise") return revise(card, data);
    if (action === "start") return startFromWords(card, data, holder);
    if (action === "withdraw") return withdraw(card, data);
    if (action === "done") return done(card, data);
    if (action === "join") return join(card, data);
    return reopen(card);
  }
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
  // pair start --from links one session to a card started in a
  // sub-session or with a new agent. Starting the card is the reviewer's
  // instruction, so a card nobody started links to no session.
  function linkable(id) {
    open();
    const card = find(id);
    requireValue(
      !card.started?.session,
      `Proposal ${id} is already linked to session ${card.started?.session?.dir}`,
      409,
    );
    requireValue(!card.done, `Proposal ${id} is already marked done.`, 409);
    requireValue(
      card.started && card.started.where !== "here",
      card.started
        ? `The reviewer approved proposal ${id} to run in session ${directory} itself, so build it in that session's rounds, not with pair start --from.`
        : `The reviewer has not approved proposal ${id}. Only run pair start --from for a proposal the reviewer approved to run in a sub-session or with a new agent.`,
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
  // The first Build it in a linked session marks its card built.
  async function built(id, sessionId) {
    const card = cards.get(id);
    if (!card || card.started?.session?.id !== sessionId || card.started.built)
      return;
    await save(card, { started: { ...card.started, built: timestamp() } });
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
    joinedInto,
    closedSession,
    built,
    openAgent,
    propose,
    writeStatus,
    startProposal,
    declineProposal,
    restoreProposal,
  };
}
