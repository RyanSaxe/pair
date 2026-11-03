import assert from "node:assert/strict";
import test from "node:test";
import {
  bellRows,
  notificationRows,
  previewRow,
  rowHtml,
  whereText,
} from "#frame/search/notification-rows.mjs";
import { matchOf, targetOf } from "#frame/search/open.mjs";
import { bellLines } from "#frame/sync/center.mjs";

const THIS = "here";
const at = (minute) => `2026-09-28T10:${String(minute).padStart(2, "0")}:00Z`;
const reply = (id, thread, message, minute, extra = {}) => ({
  id,
  kind: "reply",
  name: "A mascot pet",
  round: "2",
  page: "pet",
  thread,
  message,
  words: `Reply ${id}`,
  at: at(minute),
  ...extra,
});
const session = (id, title, events, extra = {}) => ({
  id,
  title,
  round: "2",
  url: `/s/${id}/`,
  events,
  ...extra,
});
const rowsFor = (sessions, lines = {}, cleared = new Set()) =>
  notificationRows(sessions, lines, cleared, THIS);
const rowOf = (rows, key) => rows.find((row) => row.key === key);

test("two new replies in a thread make one row with both IDs, its newest words and its count", () => {
  const sessions = [
    session(THIS, "Here", [
      reply("first", "t", 1, 1),
      reply("second", "t", 3, 2),
      reply("other", "u", 1, 3),
    ]),
  ];
  const rows = bellRows(bellLines(sessions, new Set(), THIS), THIS);
  assert.equal(rows.length, 2);
  const row = rowOf(rows, "thread:t");
  assert.equal(row.count, 2);
  assert.equal(row.words, "Reply second");
  assert.equal(row.message, 3);
  assert.deepEqual(row.events, ["second", "first"]);
});

test("a session start is listed and never unread", () => {
  const start = {
    id: "s",
    kind: "session",
    agent: "Claude Code",
    at: at(1),
  };
  const rows = rowsFor([session("other", "Elsewhere", [start])]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "session");
  assert.equal(rows[0].state, "read");
  assert.equal(rows[0].words, "Claude Code started a session");
  assert.equal(whereText(rows[0]), "Elsewhere");
});

test("each row's words read as approved in every state", () => {
  const line = (thread, extra) => ({
    thread,
    name: "A mascot pet",
    text: "Newest message",
    message: 2,
    at: at(5),
    round: "2",
    page: "pet",
    ...extra,
  });
  const sessions = [
    session(THIS, "Here", [
      reply("h2", "fresh", 1, 1),
      reply("h3", "fresh", 3, 2),
    ]),
    session(
      "other",
      "Elsewhere",
      [
        reply("o1", "far", 1, 3),
        { id: "w", kind: "waiting", round: "2", at: at(4) },
        { id: "w1", kind: "waiting", round: "1", at: at(1) },
        {
          id: "p1",
          kind: "proposal",
          name: "Restart the server",
          proposal: "open",
          at: at(5),
        },
        {
          id: "p2",
          kind: "proposal",
          name: "Build the deck",
          proposal: "going",
          acknowledged: true,
          at: at(6),
        },
      ],
      { needsYou: true },
    ),
  ];
  const lines = {
    [THIS]: {
      threads: [
        line("new", { waitingSince: at(5), readAt: null }),
        line("seen", { waitingSince: at(5), readAt: at(6) }),
        line("done", { answeredAt: at(5) }),
      ],
      proposals: [],
    },
    other: {
      threads: [line("oldthread", { answeredAt: at(5) })],
      proposals: [
        {
          id: "open",
          declined: false,
          withdrawn: false,
          done: false,
          started: null,
        },
        {
          id: "going",
          declined: false,
          withdrawn: false,
          done: false,
          started: { where: "here" },
        },
      ],
    },
  };
  const rows = rowsFor(sessions, lines);
  const said = (key) => {
    const row = rowOf(rows, key);
    return [row.state, row.words, whereText(row)];
  };
  assert.deepEqual(said("thread:fresh"), [
    "unread",
    "Reply h3",
    "A mascot pet · 2 replies",
  ]);
  assert.deepEqual(said("thread:far"), ["unread", "Reply o1", "Elsewhere"]);
  assert.deepEqual(said("thread:new"), [
    "waiting",
    "Newest message",
    "Not opened · A mascot pet",
  ]);
  assert.deepEqual(said("thread:seen"), [
    "waiting",
    "Newest message",
    "Read, no reply · A mascot pet",
  ]);
  assert.deepEqual(said("thread:done"), [
    "read",
    "Newest message",
    "A mascot pet",
  ]);
  assert.deepEqual(said("thread:oldthread"), [
    "read",
    "Newest message",
    "Elsewhere",
  ]);
  assert.deepEqual(said("round:other:2"), [
    "unread",
    "Round 2 is waiting for you",
    "Elsewhere",
  ]);
  assert.deepEqual(said("round:other:1"), [
    "read",
    "Round 1 published",
    "Elsewhere",
  ]);
  assert.deepEqual(said("proposal:other:open"), [
    "unread",
    "Proposal: Restart the server",
    "Waiting for Start · Elsewhere",
  ]);
  assert.deepEqual(said("proposal:other:going"), [
    "read",
    "Proposal: Build the deck",
    "Working here · Elsewhere",
  ]);
});

test("a closed session lists no rows", () => {
  const rows = rowsFor([
    session("gone", "Gone", [reply("r", "t", 1, 1)], { closed: true }),
  ]);
  assert.deepEqual(rows, []);
});

test("a row goes to its message, its card or its round's first page, as a search result does", () => {
  const sessions = [
    session(
      THIS,
      "Here",
      [
        reply("r", "t", 3, 1),
        {
          id: "p",
          kind: "proposal",
          name: "Restart",
          proposal: "restart",
          page: "work",
          at: at(2),
        },
        { id: "w", kind: "waiting", round: "1", at: at(3) },
        { id: "s", kind: "session", agent: "Claude Code", at: at(4) },
      ],
      { needsYou: true },
    ),
  ];
  const rows = rowsFor(sessions);
  const thread = previewRow(rowOf(rows, "thread:t"));
  assert.equal(targetOf(thread), "thread-t-3");
  assert.equal(thread.page, "pet");
  assert.equal(thread.round, "2");
  assert.equal(matchOf(thread, "frozen"), "frozen");
  const card = previewRow(rowOf(rows, "proposal:here:restart"));
  assert.equal(targetOf(card), "proposal-restart");
  assert.equal(card.page, "work");
  const round = previewRow(rowOf(rows, "round:here:1"));
  assert.equal(targetOf(round), null);
  assert.deepEqual([round.page, round.round], ["agreed", "1"]);
  const start = previewRow(rows.find(({ kind }) => kind === "session"));
  assert.equal(targetOf(start), null);
  assert.deepEqual([start.page, start.round], ["agreed", "2"]);
});

test("a row escapes an agent's words, and marks the words typed in the field", () => {
  const [row] = rowsFor([
    session(THIS, "Here", [
      reply("r", "t", 1, 1, { words: "A <img src=x> frozen <b>word</b>" }),
    ]),
  ]);
  const html = rowHtml(row, 0, { selected: -1, query: "frozen" });
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("<b>word"), false);
  assert.match(html, /<mark>frozen<\/mark>/);
});
