import assert from "node:assert/strict";
import test from "node:test";
import * as antigravity from "../../adapters/antigravity/wake.mjs";
import { detectWake, identify } from "../../src/hub/wake.mjs";

// agy gives each command that its agent runs these variables.
const session = {
  ANTIGRAVITY_CONVERSATION_ID: "conversation-1",
  ANTIGRAVITY_LS_ADDRESS: "localhost:61712",
  ANTIGRAVITY_CSRF_TOKEN: "csrf-1",
  ANTIGRAVITY_AGENTAPI_EXE: "/opt/agy",
};
const insideAgy = { ancestors: () => [{ pid: 3, command: "agy" }] };

// languageServer stands in for a running agy's language server, as agy's
// agentapi reaches it. Its run is the hub's run(file, args, env) for
// that agentapi: it adds a message to a conversation when env has the
// server's address and token, and fails otherwise with the JSON that agentapi
// prints, as the hub's run rejects with a program's output.
function languageServer({ address, token, conversations }) {
  const messages = [];
  const fail = (error) => {
    throw new Error(JSON.stringify({ response: {}, error }, null, 2));
  };
  const run = async (file, [command, action, recipient, content], env) => {
    assert.deepEqual(
      [file, command, action],
      ["/opt/agy", "agentapi", "send-message"],
    );
    if (env.ANTIGRAVITY_LS_ADDRESS !== address)
      fail(
        `dial tcp ${env.ANTIGRAVITY_LS_ADDRESS}: connect: connection refused`,
      );
    if (env.ANTIGRAVITY_CSRF_TOKEN !== token)
      fail(
        "rpc error: code = Unauthenticated desc = unauthenticated: missing CSRF token",
      );
    if (!conversations.includes(recipient))
      fail(`conversation ${recipient} not found`);
    messages.push({ recipient, content });
  };
  return { run, messages };
}

test("inside agy, a wake sends the line to the session's conversation through agentapi, with its language server's address and token", async () => {
  const target = detectWake(session, insideAgy);
  assert.deepEqual(identify(target), {
    harness: "antigravity",
    id: "conversation-1",
  });
  const server = languageServer({
    address: "localhost:61712",
    token: "csrf-1",
    conversations: ["conversation-1"],
  });
  const line = "pair: the reviewer submitted round 1 of session /s.";
  assert.deepEqual(await antigravity.wake(target, line, server.run), {
    via: "send-message",
    steerable: true,
  });
  assert.deepEqual(server.messages, [
    { recipient: "conversation-1", content: line },
  ]);
});

// After agy exits, or restarts on a new address with a new token, agentapi
// fails until the agent's next pair command sends the new address and token.
test("an Antigravity CLI wake fails with agentapi's error", async () => {
  const target = detectWake(session, insideAgy);
  const restarted = languageServer({
    address: "localhost:62000",
    token: "csrf-2",
    conversations: ["conversation-1"],
  });
  await assert.rejects(antigravity.wake(target, "line", restarted.run), {
    message: "dial tcp localhost:61712: connect: connection refused",
  });
  assert.deepEqual(restarted.messages, []);
});

// agy gives a hook only the conversation ID.
test("pair refuses an agy command without the language server's address and token", () => {
  assert.throws(
    () =>
      detectWake({ ANTIGRAVITY_CONVERSATION_ID: "conversation-1" }, insideAgy, {
        conversationId: "conversation-1",
      }),
    { message: antigravity.unwakeable },
  );
});
