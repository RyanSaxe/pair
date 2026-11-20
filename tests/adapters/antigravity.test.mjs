import assert from "node:assert/strict";
import test from "node:test";
import * as antigravity from "../../adapters/antigravity/wake.mjs";
import { detectWake } from "../../src/hub/wake.mjs";

// agy cannot run in CI, so this test checks only pair's side: the values
// that agy gives a command reach the agentapi call that wakes the session.
test("a wake from inside agy runs agentapi with the session's conversation, language server address and token", async () => {
  const target = detectWake(
    {
      ANTIGRAVITY_CONVERSATION_ID: "conversation-1",
      ANTIGRAVITY_LS_ADDRESS: "localhost:61712",
      ANTIGRAVITY_CSRF_TOKEN: "csrf-1",
      ANTIGRAVITY_AGENTAPI_EXE: "/opt/agy",
    },
    { ancestors: () => [{ pid: 3, command: "agy" }] },
  );
  const line = "pair: the reviewer submitted round 1 of session /s.";
  const runs = [];
  await antigravity.wake(target, line, async (file, args, env) => {
    runs.push({ file, args, env });
  });
  assert.deepEqual(runs, [
    {
      file: "/opt/agy",
      args: ["agentapi", "send-message", "conversation-1", line],
      env: {
        ANTIGRAVITY_LS_ADDRESS: "localhost:61712",
        ANTIGRAVITY_CSRF_TOKEN: "csrf-1",
      },
    },
  ]);
});
