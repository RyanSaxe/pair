import fs from "node:fs/promises";
import path from "node:path";
import { adapters } from "../hub/wake.mjs";
import { listing, usageError } from "./arguments.mjs";
import { rows } from "./output.mjs";
import { openSession } from "./session.mjs";
import {
  closedText,
  declinedText,
  feedbackText,
  joinedInto,
  runningText,
  startText,
  threadIndex,
  threadText,
} from "./tags.mjs";

// The session commands other than start and publish: the action each sends
// the hub, and the output it prints. A hub of the previous release answers
// reply with text, which prints as it is.

export async function read(options) {
  const { submission } = options;
  if (options.thread !== undefined && submission !== undefined)
    throw usageError(
      "read",
      "pair read takes --submission or --thread, not both.",
    );
  const session = await openSession(options);
  if (options.thread !== undefined) return readThread(session, options.thread);
  const result = await session.request({ action: "read", id: submission });
  const declined = result.declined?.length ? result.declined : null;
  const closed = result.closed?.length ? result.closed : null;
  const cards = result.status?.proposals;
  return {
    next: result.next,
    moment: [
      ...[result.moment].flat(),
      declined && "read-declined",
      closed && "read-closed",
    ].filter(Boolean),
    data: [
      result.event
        ? result.event.payload.intent === "start"
          ? startText(result.event, result.proposal, cards)
          : feedbackText(result.event)
        : declined || closed
          ? ""
          : "You have read everything the reviewer sent.",
      runningText(result.running, cards),
      declinedText(declined),
      closedText(closed),
      threadIndex(result.threads, result.threadsSince, session.directory),
    ]
      .filter(Boolean)
      .join("\n\n"),
    json: result,
    sessionDir: session.directory,
    subject: "submission",
  };
}

// The hub's reply action without text marks a thread read and returns it.
async function readThread(session, id) {
  const result = await session.request({ action: "reply", note: id });
  if (result.text !== undefined) return { data: result.text, json: result };
  return {
    next: result.next,
    moment: result.moment,
    data: threadText(result.thread),
    json: result,
    sessionDir: session.directory,
    subject: "thread",
  };
}

export async function reply(options) {
  const id = options.thread;
  if (options.text !== undefined && options.file !== undefined)
    throw usageError("reply", "pair reply takes --text or --file, not both.");
  const text = options.text !== undefined;
  if (!text && options.file === undefined)
    throw usageError(
      "reply",
      "pair reply requires --text TEXT or --file HTML.",
    );
  const session = await openSession(options);
  const result = await session.request({
    action: "reply",
    note: id,
    ...(text
      ? { text: options.text }
      : { html: await fs.readFile(path.resolve(options.file), "utf8") }),
  });
  if (result.text !== undefined) return { data: result.text, json: result };
  return {
    next: result.next,
    data: `Posted your reply in thread ${id}.`,
    json: result,
  };
}

// A note is checked before anything is sent, so a refused note leaves the
// pages it names unstarted.
function noteText(options) {
  if (options.note === undefined) return undefined;
  const note = options.note.trim();
  if (!note || note.length > 80)
    throw usageError(
      "progress",
      `--note takes text of 1 to 80 characters, and this note has ${note.length}.`,
    );
  return note;
}

export async function progress(options) {
  const pages = options.page;
  const note = noteText(options);
  if (!pages && note === undefined)
    throw usageError(
      "progress",
      "pair progress requires --page ID or --note TEXT.",
    );
  const session = await openSession(options);
  if (!pages) {
    const result = await session.request({ action: "ack", note });
    return {
      next: result.next,
      data: `Noted on the round: ${note}`,
      json: result,
    };
  }
  // progress refuses an unknown or published page before anything changes,
  // and ack then puts the note on each page.
  let result = await session.request({ action: "progress", start: pages });
  if (note !== undefined)
    for (const page of pages)
      result = await session.request({ action: "ack", note, page });
  return {
    next: result.next,
    data:
      note === undefined
        ? `Started: ${pages.join(", ")}.`
        : `Noted on ${pages.join(", ")}: ${note}`,
    json: result,
  };
}

const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);

export async function pause(options) {
  const session = await openSession(options);
  const result = await session.request({
    action: "pause",
    reason: options.reason,
  });
  return {
    next: result.next,
    data: `Paused: ${sentence(options.reason.trim())}`,
    json: result,
  };
}

const clock = (at) => new Date(at).toTimeString().slice(0, 5);

function stageText(status) {
  if (status.paused) return `paused: ${status.paused.reason}`;
  if (status.stage === "complete") return "closed by the reviewer";
  if (status.openRound) return "the agent publishes its pages";
  if (status.stage === "submitted")
    return "the reviewer sent something that pair read has not printed yet";
  if (status.stage === "working") return "the agent works on the next round";
  return status.current
    ? "the reviewer has not sent feedback yet"
    : "the agent publishes Agreed";
}

// The hub's page states, in the words pair status prints.
const pageStates = {
  queued: "not started",
  active: "started",
  ready: "published",
};

function holderText({ holder, wake }) {
  if (!holder) return "none";
  const last = wake?.last;
  const sent = !last
    ? ""
    : last.ok
      ? ` Last wake ${clock(last.at)}, sent.`
      : ` Last wake ${clock(last.at)}, failed: ${last.reason}`;
  return `${adapters[holder.harness]?.name || holder.harness} since ${clock(holder.at)}.${sent}`;
}

// A proposal's state, from its facts and the cards joined into it, as pair
// propose and pair status print it.
const places = {
  here: "here",
  "sub-session": "in a sub-session",
  "new-agent": "with a new agent",
};
function proposalState(card, cards) {
  const { status } = card;
  const parts = status
    ? `, ${status.done.length} of ${status.done.length + status.left.length} parts done`
    : "";
  const joined = joinedInto(card, cards).map((item) => item.id);
  const joins = joined.length ? `, joined by ${listing(joined)}` : "";
  if (card.declined) return `declined${joins}`;
  if (card.withdrawn) return `withdrawn${joins}`;
  if (card.done?.joined) return `done, joined into ${card.done.joined}`;
  if (card.done)
    return `done ${card.done.where ?? places[card.started.where]}${joins}`;
  if (card.started) {
    const { where, planFirst, built } = card.started;
    const planning = planFirst && !built ? ", planning first" : "";
    return `approved to run ${places[where]}${planning}${parts}${joins}`;
  }
  return `proposed${joins}`;
}

function proposalsText(cards) {
  if (!cards?.length) return "";
  const states = cards.map((card) => proposalState(card, cards));
  const width = (values) => Math.max(...values.map((value) => value.length));
  const idWidth = width(cards.map((card) => card.id));
  const stateWidth = width(states);
  return [
    "Proposals",
    ...cards.map((card, index) =>
      [
        `  ${card.id.padEnd(idWidth)}`,
        states[index].padEnd(stateWidth),
        card.title,
      ].join("  "),
    ),
  ].join("\n");
}

// The sessions linked to this one, one per started proposal.
function linkedText(cards = []) {
  const linked = cards.filter((card) => card.started?.session && !card.done);
  return linked
    .map((card) => `${card.id} in ${card.started.session.dir}`)
    .join(", ");
}

export async function propose(options) {
  const session = await openSession(options, { anyAgent: true });
  // The hub checks that each flag goes with the action given.
  const flags = [
    "id",
    ...["title", "delivers", "recommend", "page", "thread", "revise"],
    ...["start", "quote", "withdraw", "reason", "done", "where", "join"],
    "reopen",
  ];
  const result = await session.request({
    action: "propose",
    ...Object.fromEntries(flags.map((name) => [name, options[name]])),
    statusDone: options["status-done"],
    statusLeft: options["status-left"],
  });
  const card = result.proposal;
  const where = result.parent ? ` in session "${result.parent.title}"` : "";
  const status = options["status-done"] || options["status-left"];
  return {
    next: result.next,
    data: [
      `Proposal ${card.id}${where}: ${proposalState(card)}.`,
      status && leftText(card, session.directory),
    ]
      .filter(Boolean)
      .join("\n"),
    json: result,
  };
}

// After a status, the parts left, or how the work finishes when none is.
function leftText(card, directory) {
  const { left } = card.status;
  if (left.length)
    return `Left: ${sentence(left.join("; "))}\nBuild the next part. When you finish it, or the parts change, run the same command again with the whole list.`;
  if (card.started.where === "here")
    return `Nothing is left. After you publish the work's last page, run pair propose --session-dir ${directory} --id ${card.id} --done.`;
  return "Nothing is left. Publish the work's last page. The hub marks the work done when the reviewer closes the work's linked session.";
}

export async function status(options) {
  const session = await openSession(options, { anyAgent: true });
  const result = await session.request({ action: "status" });
  const { status: state } = result;
  const round = state.current;
  return {
    next: result.next,
    data: [
      rows([
        ["Session", session.directory],
        ["URL", session.url()],
        ["Title", state.title],
        [
          "Round",
          round
            ? `${round.round}, ${stageText(state)}`
            : `none published yet, ${stageText(state)}`,
        ],
        [
          "Pages",
          state.openRound?.pages
            .map((page) => `${page.id} (${pageStates[page.state]})`)
            .join(", "),
        ],
        ["Holder", holderText(state)],
        ["Handoff", state.handoff],
        [
          "Parent",
          state.parent &&
            `${state.parent.sessionDir}, proposal ${state.parent.proposal}`,
        ],
        ["Linked sessions", linkedText(state.proposals)],
      ]),
      proposalsText(state.proposals),
    ]
      .filter(Boolean)
      .join("\n\n"),
    json: state,
    sessionDir: session.directory,
    subject: "status",
  };
}
