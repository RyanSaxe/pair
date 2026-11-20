import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import * as antigravity from "../../adapters/antigravity/wake.mjs";
import { detectWake } from "../../src/hub/wake.mjs";
import { agentsScratch } from "../support/agents.mjs";

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

// An agy subagent shares its parent's agy process with a conversation ID of
// its own. Without parentSession it would replace its parent's entry in pair
// agents; with parentSession and subagentTool, pair refuses to list it, names
// its messages through the parent by role, and relays --to NAME/SUBAGENT
// through the parent with send_message.
test("an agy subagent keeps its parent listed, sends through its parent by role, and receives via send_message", async (t) => {
  const { home, folder, agent, agents } = await agentsScratch(t);
  const directory = await folder("api");
  const sentLog = path.join(home, "sent.jsonl");
  const conversations = {
    "conv-root": {
      parentConversationId: "",
      rootConversationId: "conv-root",
      subagentSpec: null,
    },
    "conv-sub": {
      parentConversationId: "conv-root",
      rootConversationId: "conv-root",
      subagentSpec: { role: "Codebase Researcher" },
    },
    "conv-nested": {
      parentConversationId: "conv-sub",
      rootConversationId: "conv-root",
      subagentSpec: { role: "Deep Reader" },
    },
  };
  // Node executes this file when process.execPath runs `agentapi <cmd> ...`,
  // so the stand-in works the same on macOS, Linux and Windows.
  await fs.writeFile(
    path.join(directory, "agentapi"),
    `const fs = require("node:fs");
const [command, id, message] = process.argv.slice(2);
const conversations = ${JSON.stringify(conversations)};
if (command === "get-conversation-metadata") {
  const metadata = conversations[id];
  if (!metadata) process.exit(1);
  process.stdout.write(JSON.stringify({ response: { conversationMetadata: { metadata } } }));
} else if (command === "send-message") {
  fs.appendFileSync(${JSON.stringify(sentLog)}, JSON.stringify({ id, message }) + "\\n");
}
`,
  );
  const agy = await agent(directory, {
    harness: "antigravity",
    env: {
      ANTIGRAVITY_LS_ADDRESS: "localhost:55433",
      ANTIGRAVITY_CSRF_TOKEN: "csrf-live",
      ANTIGRAVITY_AGENTAPI_EXE: process.execPath,
    },
  });
  const as = (id) => ({ env: { ANTIGRAVITY_CONVERSATION_ID: id } });

  const registered = await agy.run(["register", "--json"], as("conv-root"));
  assert.equal(registered.status, 0, registered.stderr);
  const { name: rootName } = JSON.parse(registered.stdout);

  for (const [id, role] of [
    ["conv-sub", "Codebase Researcher"],
    ["conv-nested", "Deep Reader"],
  ]) {
    const refused = await agy.run(["register"], as(id));
    assert.equal(refused.status, 1, refused.stdout);
    assert.ok(refused.stderr.includes(`${rootName}/${role}`), refused.stderr);
  }
  assert.deepEqual(
    (await agents()).map((entry) => entry.id),
    ["antigravity:conv-root"],
  );

  // Sending from the subagent names it through its parent with a quoted answer
  // command, and sending to NAME/SUBAGENT relays through the parent with
  // send_message.
  const fromSub = await agy.run(
    ["message", "--to", rootName, "--text", "Found the bug."],
    as("conv-sub"),
  );
  assert.equal(fromSub.status, 0, fromSub.stderr);

  const toSub = await agy.run(
    [
      "message",
      "--to",
      `${rootName}/Codebase Researcher`,
      "--from",
      "verifier",
      "--text",
      "Check the tests.",
    ],
    as("conv-root"),
  );
  assert.equal(toSub.status, 0, toSub.stderr);

  const sent = (await fs.readFile(sentLog, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].id, "conv-root");
  assert.match(
    sent[0].message,
    new RegExp(
      `^pair message from ${rootName}/Codebase Researcher \\(Antigravity CLI in .*\\):\\n\\nFound the bug\\.\\n\\nTo answer, run: pair message --to "antigravity:conv-root/Codebase Researcher" --text "…"`,
    ),
  );
  assert.equal(sent[1].id, "conv-root");
  assert.match(
    sent[1].message,
    /^pair message from verifier, for your subagent Codebase Researcher\. Pass the message below to Codebase Researcher unchanged with send_message, and do not act on it yourself:\n\nCheck the tests\./,
  );
});

// agy withholds ANTIGRAVITY_LS_ADDRESS and ANTIGRAVITY_CSRF_TOKEN from hooks.
// As a PreInvocation hook, pair register --hook injects one ephemeralMessage
// asking the agent to run pair register when the interactive agy process is
// not yet listed, stays silent once that process registers (and when the
// prompt already runs pair register), and injects again after a restart.
test("pair register --hook guides an unregistered agy process once per process and stays silent for non-interactive runs", async (t) => {
  const { folder, agent } = await agentsScratch(t);
  const directory = await folder("app");
  const hookEnv = { ANTIGRAVITY_CONVERSATION_ID: "conv-hook" };
  const agy = await agent(directory, { harness: "antigravity" });

  // Before registering, the hook prints an injectSteps ephemeralMessage.
  const first = await agy.run(["register", "--hook"], {
    input: JSON.stringify({
      conversationId: "conv-hook",
      invocationNum: 0,
      lastUserInput: "Check the failing tests.",
    }),
    env: hookEnv,
  });
  assert.equal(first.status, 0, first.stderr);
  const payload = JSON.parse(first.stdout);
  assert.equal(payload.injectSteps.length, 1);
  assert.match(payload.injectSteps[0].ephemeralMessage, /pair register/);

  // When the user's prompt already asks for pair register (as pair spawn
  // does), the hook prints nothing so it does not compete with --name.
  const spawned = await agy.run(["register", "--hook"], {
    input: JSON.stringify({
      conversationId: "conv-hook",
      invocationNum: 0,
      lastUserInput:
        "In your own shell, run pair register --name worker first.",
    }),
    env: hookEnv,
  });
  assert.equal(spawned.status, 0, spawned.stderr);
  assert.equal(spawned.stdout, "");

  // Once this agy process registers, later turns print nothing.
  const reg = await agy.run(["register"], {
    env: {
      ANTIGRAVITY_CONVERSATION_ID: "conv-hook",
      ANTIGRAVITY_LS_ADDRESS: "localhost:61712",
      ANTIGRAVITY_CSRF_TOKEN: "csrf-1",
      ANTIGRAVITY_AGENTAPI_EXE: "/opt/agy",
    },
  });
  assert.equal(reg.status, 0, reg.stderr);
  const after = await agy.run(["register", "--hook"], {
    input: JSON.stringify({
      conversationId: "conv-hook",
      invocationNum: 1,
      lastUserInput: "Continue.",
    }),
    env: hookEnv,
  });
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, "");

  // A new agy process (such as `agy -c` after a restart) gets the prompt again.
  const restarted = await agent(directory, { harness: "antigravity" });
  const again = await restarted.run(["register", "--hook"], {
    input: JSON.stringify({
      conversationId: "conv-hook",
      invocationNum: 0,
      lastUserInput: "Continue.",
    }),
    env: hookEnv,
  });
  assert.equal(again.status, 0, again.stderr);
  assert.match(
    JSON.parse(again.stdout).injectSteps[0].ephemeralMessage,
    /pair register/,
  );

  // Non-interactive agy runs (-p, --print, --prompt, acp) print nothing, while
  // interactive -i / --prompt-interactive still gets the ephemeralMessage.
  assert.equal(
    antigravity.hookResponse(
      { pid: 99, start: "s", command: "agy", args: "agy -p 'Reply OK'" },
      { running: [], env: hookEnv, input: {} },
    ),
    null,
  );
  assert.equal(
    antigravity.hookResponse(
      { pid: 99, start: "s", command: "agy", args: "agy acp" },
      { running: [], env: hookEnv, input: {} },
    ),
    null,
  );
  assert.ok(
    antigravity.hookResponse(
      {
        pid: 99,
        start: "s",
        command: "agy",
        args: "agy --prompt-interactive 'Check tests'",
      },
      { running: [], env: hookEnv, input: {} },
    )?.injectSteps,
  );
});
