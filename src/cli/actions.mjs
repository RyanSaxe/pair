import fs from "node:fs/promises";
import path from "node:path";
import { adapters } from "../hub/wake.mjs";
import { usageError } from "./arguments.mjs";
import { rows } from "./output.mjs";
import { openSession } from "./session.mjs";
import {
  feedbackText,
  tag,
  tagText,
  threadIndex,
  threadText,
} from "./tags.mjs";

// The session commands other than start and publish: the action each sends
// the hub, and the output it prints. A hub of the previous release answers
// reply with text, which prints as it is.

export async function read(options) {
  const submission = options.submission ?? options.id;
  if (options.thread !== undefined && submission !== undefined)
    throw usageError(
      "read",
      "pair read takes --submission or --thread, not both.",
    );
  const session = await openSession(options);
  if (options.thread !== undefined) return readThread(session, options.thread);
  const result = await session.request({ action: "read", id: submission });
  return {
    next: result.next,
    data: [
      result.event ? feedbackText(result.event) : "No submission is waiting.",
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
    data: threadText(result.thread),
    json: result,
    sessionDir: session.directory,
    subject: "thread",
  };
}

export async function reply(options) {
  const id = options.thread ?? options.note;
  if (options.text !== undefined && options.file !== undefined)
    throw usageError("reply", "pair reply takes --text or --file, not both.");
  const text = options.text !== undefined;
  if (!text && options.file === undefined) {
    // pair reply --note ID read the thread when it posted nothing.
    if (options.note !== undefined)
      return readThread(await openSession(options), id);
    throw usageError(
      "reply",
      "pair reply requires --text TEXT or --file HTML.",
    );
  }
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
  const pages = options.page ?? options.start?.split("|");
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

export async function ack(options) {
  const session = await openSession(options);
  const result = await session.request({
    action: "ack",
    note: options.note,
    page: options.page,
  });
  const note = options.note?.trim();
  return {
    next: result.next,
    data:
      note &&
      (options.page
        ? `Noted on ${options.page}: ${note}`
        : `Noted on the round: ${note}`),
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

export async function complete(options) {
  const session = await openSession(options);
  const result = await session.request({ action: "complete" });
  return { next: result.next, data: "The session is complete.", json: result };
}

const clock = (at) => new Date(at).toTimeString().slice(0, 5);

function stageText(status) {
  if (status.paused) return `paused: ${status.paused.reason}`;
  if (status.stage === "complete") return "complete";
  if (status.stage === "saved") return "saved for later";
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

function sideWorkText(items) {
  if (!items.length) return "";
  const width = (key) => Math.max(...items.map((item) => item[key].length));
  return [
    "Side work",
    ...items.flatMap((item) => [
      [
        `  ${item.id.padEnd(width("id"))}`,
        item.state.padEnd(width("state")),
        item.title,
        ...(item.url ? [item.url] : []),
      ].join("  "),
      ...(item.message
        ? [tag("pair_side_work", { id: item.id }, tagText(item.message))]
        : []),
    ]),
  ].join("\n");
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
            ? `${round.round}${round.offer ? `, offer ${round.offer}` : ""}, ${stageText(state)}`
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
      sideWorkText(state.sideWork || []),
    ]
      .filter(Boolean)
      .join("\n\n"),
    json: state,
    sessionDir: session.directory,
    subject: "status",
  };
}

export async function sideWork(change, options) {
  const session = await openSession(options, { anyAgent: true });
  const result = await session.request({
    action: "side-work",
    change,
    id: options.args[0],
    title: options.title,
    text: options.text,
    source: options.source,
    state: options.state,
    url: options.url,
  });
  const { item } = result;
  return {
    // Only an item's pull request has a step after it, for whichever agent
    // runs it.
    next: result.next,
    data: [
      `Side work ${item.id}, ${item.state}: ${item.title}`,
      ...(item.url ? [item.url] : []),
    ].join("\n"),
    json: result,
  };
}
