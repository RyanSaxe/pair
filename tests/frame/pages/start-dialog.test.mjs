import assert from "node:assert/strict";
import test from "node:test";
import { startPrompt } from "#frame/pages/start-dialog.mjs";

const sessionDir =
  "/Users/ryansaxe/.local/state/pair/sessions/f5002fab-d9ff-4fa5-a76f-cebcd74c9493";
const item = {
  id: "2",
  title: "Thread count missing on the bell",
  text: "Two threads started in this session reached the notification center, but no blue count appeared for them. The count should show each unread thread notification.",
  source: "Your overall note in round 1",
};
const prefix = [
  "Plan this side work in a new pair session. Run pair guide and follow what it prints.",
  `Side work 2 from the pair session in ${sessionDir}:\n${item.title}\n${item.text}\nSource: ${item.source}`,
];
const ending = `Once your pair session has started, close the item in that session with pair side-work update 2 --state moved --url NEW_SESSION_URL --session-dir ${sessionDir}, where NEW_SESSION_URL is the url that pair start printed.`;

test("startPrompt gives the new session the item and move command", () => {
  assert.equal(startPrompt(item, sessionDir), [...prefix, ending].join("\n\n"));
  assert.equal(
    startPrompt(
      item,
      sessionDir,
      "Count only threads with an answer you have not opened.",
    ),
    [
      ...prefix,
      "My note: Count only threads with an answer you have not opened.",
      ending,
    ].join("\n\n"),
  );
});
