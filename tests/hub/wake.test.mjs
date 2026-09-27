import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { withSandboxHint } from "../../adapters/codex/rules.mjs";
import { detectWake } from "../../src/hub/wake.mjs";
import {
  act,
  failWakes,
  hub,
  post,
  publishRound,
  sessionDir,
  sessionId,
  status,
  token,
  wakes,
} from "../support/wake-hub.mjs";

test("read returns the oldest unread submission once and marks it read", async () => {
  assert.equal((await status()).latestSubmissionRound, "1");
  const first = await act({ action: "read" });
  assert.ok(first.ok, JSON.stringify(first.body));
  assert.equal(first.body.event.id, "evt1");
  assert.equal(first.body.status.stage, "working");
  const acked = (await status()).acknowledgedAt;
  assert.equal((await act({ action: "read" })).body.event, null);
  const again = await act({ action: "read", id: "evt1" });
  assert.equal(again.body.event.id, "evt1");
  assert.equal((await status()).acknowledgedAt, acked);
  assert.equal((await act({ action: "read", id: "nope" })).status, 404);
});

test("the sandbox hint follows a refusal, not the environment alone", () => {
  const env = { CODEX_SANDBOX: "seatbelt" };
  assert.match(
    withSandboxHint("connect EPERM 127.0.0.1:4747", env),
    /outside the sandbox/,
  );
  assert.equal(withSandboxHint("Unknown session", env), "Unknown session");
  assert.equal(
    withSandboxHint("connect EPERM 127.0.0.1:4747", {}),
    "connect EPERM 127.0.0.1:4747",
  );
});

test("a complete page round opens the next round", async () => {
  assert.ok((await publishRound("2")).ok);
  const view = await status();
  assert.equal(view.stage, "updated");
  assert.equal(view.openRound, null);
});

const feedback = (id) =>
  post(
    `/s/${sessionId}/api/feedback`,
    {
      sessionId,
      id,
      name: "t",
      round: "2",
      intent: "feedback-only",
      groups: { alignUnflagged: true, choices: {}, notes: [] },
      text: "hi",
    },
    { origin: hub.origin },
  );

test("feedback alignment must be boolean when present", async () => {
  const invalid = await post(
    `/s/${sessionId}/api/feedback`,
    {
      sessionId,
      id: "bad-alignment",
      name: "t",
      round: "2",
      intent: "feedback-only",
      groups: { alignUnflagged: "yes", choices: {}, notes: [] },
      text: "hi",
    },
    { origin: hub.origin },
  );
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /alignUnflagged must be a boolean/);
});

// The before hook's submission already woke the agent once, so each test
// waits for its own wake by count and for its result to reach the status.
const settled = async (count, ok = true) => {
  for (let i = 0; i < 50; i++) {
    const view = await status();
    if (wakes.length === count && view.wake?.last?.ok === ok) return view;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the wake was never recorded");
};

test("registration stores the wake target for the agent only", async () => {
  const connection = JSON.parse(
    await fs.readFile(path.join(sessionDir, "connection.json"), "utf8"),
  );
  assert.deepEqual(connection.wake, { harness: "codex" });
  const stored = JSON.parse(
    await fs.readFile(path.join(sessionDir, "wake.json"), "utf8"),
  );
  assert.deepEqual(stored, { harness: "codex", thread: "thread-1" });
  const view = await status();
  assert.equal(view.wake.harness, "codex");
  assert.equal(JSON.stringify(view).includes("thread-1"), false);
  const refused = await post(
    "/agent/register",
    { sessionDir, wake: { harness: "vim" } },
    { authorization: `Bearer ${hub.secret}` },
  );
  assert.equal(refused.status, 400);
});

test("a submission wakes the agent with the line that names the session", async () => {
  assert.equal(wakes.length, 1);
  assert.ok((await feedback("evt2")).ok);
  const view = await settled(2);
  assert.equal(view.latestSubmissionRound, "2");
  assert.deepEqual(wakes[1].target, { harness: "codex", thread: "thread-1" });
  assert.match(
    wakes[1].line,
    new RegExp(
      `^pair: feedback arrived on session ${sessionDir} \\(Round 2\\)\\. Run first: pair ack --session-dir ${sessionDir}\\.`,
    ),
  );
  assert.equal(view.wake.last.ok, true);
  assert.equal((await act({ action: "read" })).body.event.id, "evt2");
});

test("a failed wake is recorded and the submission stays readable", async () => {
  failWakes(true);
  assert.ok((await feedback("evt3")).ok);
  const view = await settled(3, false);
  failWakes(false);
  assert.equal(view.wake.last.ok, false);
  assert.equal(view.wake.last.reason, "thread gone");
  const next = await fetch(`${hub.origin}/agent/${sessionId}/next`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((response) => response.json());
  assert.equal(next.event.id, "evt3");
  assert.equal((await act({ action: "read" })).body.event.id, "evt3");
});

test("a paused session is not woken until it registers again", async () => {
  const count = wakes.length;
  assert.equal((await act({ action: "pause" })).status, 400);
  assert.ok((await act({ action: "pause", reason: "asked to stop" })).ok);
  assert.equal((await status()).paused.reason, "asked to stop");
  assert.ok((await feedback("evt4")).ok);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(wakes.length, count);
  assert.equal(
    (await fetch(`${hub.origin}/api/sessions`).then((r) => r.json()))
      .sessions[0].paused,
    true,
  );
  const again = await post(
    "/agent/register",
    { sessionDir, wake: { harness: "codex", thread: "thread-1" } },
    { authorization: `Bearer ${hub.secret}` },
  );
  assert.ok(again.ok);
  assert.equal((await status()).paused, null);
  assert.equal((await act({ action: "read" })).body.event.id, "evt4");
});

const tools = (chain, port = 4321, sdk = "/sdk/index.js") => ({
  ancestors: () => chain,
  listeningPort: () => port,
  copilotSdk: () => ({ sdk, tried: ["/a/index.js"] }),
});

const claude = {
  CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/1.sock",
  CLAUDE_CODE_MESSAGING_TOKEN: "tok",
};

test("the nearest harness ancestor decides the wake target", () => {
  const env = { ...claude, CODEX_THREAD_ID: "outer" };
  assert.deepEqual(
    detectWake(
      env,
      tools([
        { pid: 2, command: "zsh" },
        { pid: 3, command: "claude" },
        { pid: 4, command: "codex" },
      ]),
    ),
    {
      harness: "claude-code",
      socket: claude.CLAUDE_CODE_MESSAGING_SOCKET,
      token: "tok",
    },
  );
  assert.deepEqual(
    detectWake({ CODEX_THREAD_ID: "t" }, tools([{ pid: 3, command: "codex" }])),
    { harness: "codex", thread: "t" },
  );
  assert.deepEqual(
    detectWake(
      { COPILOT_AGENT_SESSION_ID: "s" },
      tools([{ pid: 3, command: "copilot" }]),
    ),
    { harness: "copilot", sessionId: "s", port: 4321, sdk: "/sdk/index.js" },
  );
  assert.deepEqual(
    detectWake({ CODEX_THREAD_ID: "t" }, tools([{ pid: 2, command: "sh" }])),
    { harness: "codex", thread: "t" },
  );
});

test("start refuses without a wake path and says what to do", () => {
  assert.throws(() => detectWake({}, tools([])), /no wake path/);
  assert.throws(
    () =>
      detectWake(
        { COPILOT_AGENT_SESSION_ID: "s" },
        tools([{ pid: 3, command: "copilot" }], null),
      ),
    /copilot --ui-server --resume s` and run `pair start` again/,
  );
  assert.throws(
    () =>
      detectWake(
        { COPILOT_AGENT_SESSION_ID: "s" },
        tools([{ pid: 3, command: "copilot" }], 4321, null),
      ),
    /SDK was not found at \/a\/index\.js/,
  );
});
