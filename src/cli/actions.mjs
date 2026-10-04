import fs from "node:fs/promises";
import path from "node:path";
import { adapters } from "../hub/wake.mjs";
import { usageError } from "./arguments.mjs";
import { rows } from "./output.mjs";
import { openSession } from "./session.mjs";
import {
  declinedText,
  feedbackText,
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
  return {
    next: result.next,
    moment: [result.moment, declined && "read-declined"].filter(Boolean),
    data: [
      result.event
        ? result.event.payload.intent === "start"
          ? startText(result.event, result.proposal)
          : feedbackText(result.event)
        : declined
          ? ""
          : "No submission is waiting.",
      declinedText(declined),
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
  if (status.stage === "complete") return "complete";
  if (status.openRound) return "the agent publishes its pages";
  if (status.stage === "submitted")
    return "a submission is waiting for pair read";
  if (status.stage === "working") return "the agent works on the next round";
  return "waiting for the reviewer";
}

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

// A proposal's state, from its facts, as pair propose and pair status print
// it.
const places = {
  here: "here",
  "sub-session": "in a sub-session",
  "new-agent": "with a new agent",
};
function proposalState(card) {
  if (card.declined) return "declined";
  if (card.done) return `done ${places[card.started.where]}`;
  if (card.started) return `started ${places[card.started.where]}`;
  return "proposed";
}

function proposalsText(cards) {
  if (!cards?.length) return "";
  const states = cards.map(proposalState);
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

export async function propose(options) {
  const session = await openSession(options, { anyAgent: true });
  const fields = ["title", "delivers", "changes", "recommend", "reason"];
  const result = await session.request({
    action: "propose",
    id: options.id,
    ...Object.fromEntries(fields.map((name) => [name, options[name]])),
    source: options.source,
    thread: options.thread,
    page: options.page,
    revise: options.revise,
    start: options.start,
    done: options.done,
    reopen: options.reopen,
  });
  const card = result.proposal;
  return {
    next: result.next,
    data: `Proposal ${card.id}: ${proposalState(card)}.`,
    json: result,
  };
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
            .map((page) => `${page.id} (${page.state})`)
            .join(", "),
        ],
        ["Holder", holderText(state)],
        ["Handoff", state.handoff],
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
