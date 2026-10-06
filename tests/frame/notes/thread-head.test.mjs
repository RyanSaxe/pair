import assert from "node:assert/strict";
import { test } from "node:test";
import { threadTitle } from "#frame/notes/thread-head.mjs";

// A thread as the hub stores it, on a page titled Tonight, with a message
// from the reviewer and the agent's reply.
const thread = (fields) => ({
  page: "Tonight",
  state: "replied",
  messages: [{ from: "reviewer" }, { from: "agent" }],
  ...fields,
});

// Each row of the rules the reviewer approved: what the thread was started
// on, the part of its block its words are in, and the name its card's head
// gives it open and collapsed. A thread on words has the page's title as its
// anchor, as a note on selected words does.
const rules = [
  [
    "words in a paragraph",
    { anchor: "Tonight", quote: "no-install checkout" },
    null,
    "On the words you selected",
    "On “no-install checkout”",
  ],
  [
    "words in a table cell",
    { anchor: "Tonight", quote: "writing its reply" },
    "row Read",
    "On row Read",
    "On “writing its reply” in row Read",
  ],
  [
    "words in a code block",
    { anchor: "Tonight", quote: "at.parentElement !== root" },
    "line 4",
    "On line 4",
    "On “at.parentElement !== root” in line 4",
  ],
  [
    "words in a decision option",
    { anchor: "Tonight", quote: "a link that scrolls to it" },
    "option Named, same place",
    "On option Named, same place",
    "On “a link that scrolls to it” in option Named, same place",
  ],
  [
    "words in a checklist item",
    { anchor: "Tonight", quote: "with a reply from the agent" },
    "item A thread card",
    "On item A thread card",
    "On “with a reply from the agent” in item A thread card",
  ],
  [
    "a whole block",
    { anchor: "Thread states", target: "block-tonight-4" },
    null,
    "On Thread states",
    "On Thread states",
  ],
  [
    "a behavior case",
    { anchor: "retry-twice: A charge times out", target: "retry-twice" },
    null,
    "On retry-twice: A charge times out",
    "On retry-twice: A charge times out",
  ],
  [
    "an agreement",
    {
      page: "Agreed",
      anchor: "Type checking waits until after tonight",
      target: "agreement-types",
      agreementId: "types",
    },
    null,
    "On Type checking waits until after tonight",
    "On Type checking waits until after tonight",
  ],
  [
    "the task",
    {
      page: "Agreed",
      anchor: "The task",
      target: "agreement-task",
      agreementId: "task",
    },
    null,
    "On the task",
    "On the task",
  ],
  ["the page", { anchor: "Tonight" }, null, "On this page", "On this page"],
];
for (const [kind, fields, part, open, collapsed] of rules)
  test(`a card on ${kind} is headed ${open}`, () => {
    assert.equal(threadTitle(thread(fields), part, false).name, open);
    assert.equal(threadTitle(thread(fields), part, true).name, collapsed);
  });

test("a collapsed card names the words it hides as one line cut at 40 characters", () => {
  const words = thread({
    anchor: "Tonight",
    quote:
      "A worktree runs its own code as node src/cli.mjs,\n  and a checkout runs as it is",
  });
  assert.equal(
    threadTitle(words, null, true).name,
    "On “A worktree runs its own code as node sr…”",
  );
});

test("a head counts the messages, and a collapsed head adds the thread's state", () => {
  const sent = thread({
    anchor: "Thread states",
    target: "block-tonight-4",
    state: "sent",
    messages: [{ from: "reviewer" }],
  });
  assert.equal(threadTitle(sent, null, false).meta, "1 message");
  assert.equal(
    threadTitle(sent, null, true).meta,
    "1 message · Sent to the agent",
  );
});
