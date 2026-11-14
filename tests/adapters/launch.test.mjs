import assert from "node:assert/strict";
import test from "node:test";
import { adapters } from "../../src/hub/wake.mjs";

// Each CLI parses this command line, so a changed flag starts a session that
// pair cannot recognise or that ignores the prompt.
test("each adapter's launch returns the command line that starts its CLI with the folder, name, session ID and prompt", () => {
  const sessionId = "6f1c2a9e-0d1b-4c8e-9a51-2f6b7d1e9c30";
  const prompt = 'Fix the failing test, then say "done".';
  const expected = {
    copilot: [
      "copilot",
      "-C",
      "/work/shop",
      "--ui-server",
      "--session-id",
      sessionId,
      "-n",
      "churn-export",
      "-i",
      prompt,
    ],
    codex: ["codex", "-C", "/work/shop", prompt],
    "claude-code": [
      "claude",
      "--name",
      "churn-export",
      "--session-id",
      sessionId,
      prompt,
    ],
    pi: ["pi", "--name", "churn-export", "--session-id", sessionId, prompt],
    opencode: [
      "opencode",
      "/work/shop",
      "--session",
      `ses_${sessionId}`,
      "--prompt",
      prompt,
    ],
  };
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(adapters).map(([harness, adapter]) => [
        harness,
        adapter.launch({
          directory: "/work/shop",
          name: "churn-export",
          sessionId,
          prompt,
        }),
      ]),
    ),
    expected,
  );
});
