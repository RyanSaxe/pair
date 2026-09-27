import assert from "node:assert/strict";
import { test } from "node:test";
import { withSandboxHint } from "../../adapters/codex/rules.mjs";
import { detectWake } from "../../src/hub/wake.mjs";
import { hub, planData, sleep, waitUntil } from "../support/hub.mjs";

// The hub records a wake's result in the status once the wake has finished.
const woken = (a) =>
  waitUntil(async () => Boolean((await a.status()).body.wake?.last));

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

test("no status shows the wake target", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const browser = (await a.status()).body;
  const holder = (await a.action("status")).body.status;
  for (const view of [browser, holder]) {
    assert.equal(view.wake.harness, "claude-code");
    const text = JSON.stringify(view);
    assert.equal(text.includes(a.inbox.socket), false);
    assert.equal(text.includes(a.inbox.token), false);
  }
});

test("a submission wakes the holder with the line that names the session", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const feedback = a.event();
  assert.equal((await a.feedback(feedback)).code, 200);
  assert.equal(await woken(a), true);
  const view = (await a.status()).body;
  assert.equal(view.wake.last.ok, true);
  assert.equal(view.latestSubmissionRound, "1");
  assert.deepEqual(a.inbox.wakes, [
    {
      auth: { type: "auth", token: a.inbox.token },
      message: {
        type: "user",
        message: {
          role: "user",
          content: `pair: feedback arrived on session ${a.directory} (Round 1). Run first: pair ack --session-dir ${a.directory}. It prints the next step.`,
        },
      },
    },
  ]);
  assert.equal((await a.action("read")).body.event.id, feedback.id);
});

test("a failed wake is recorded and the submission stays readable", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  // The inbox is gone, as it is once the agent's session has ended.
  await a.inbox.close();
  const feedback = a.event();
  assert.equal((await a.feedback(feedback)).code, 200);
  assert.equal(await woken(a), true);
  const { wake } = (await a.status()).body;
  assert.equal(wake.last.ok, false);
  assert.ok(wake.last.reason.includes(a.inbox.socket), wake.last.reason);
  assert.equal((await a.action("read")).body.event.id, feedback.id);
});

test("a paused session is not woken until it registers again", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  assert.equal((await a.action("pause")).code, 400);
  assert.equal(
    (await a.action("pause", { reason: "asked to stop" })).code,
    200,
  );
  assert.equal((await a.status()).body.paused.reason, "asked to stop");
  const feedback = a.event();
  assert.equal((await a.feedback(feedback)).code, 200);
  await sleep(100);
  assert.equal(a.inbox.wakes.length, 0);
  const [listed] = (await a.request("/api/sessions")).body.sessions;
  assert.equal(listed.paused, true);
  assert.equal((await h.register(a.directory, a.inbox.target)).code, 200);
  assert.equal((await a.status()).body.paused, null);
  assert.equal((await a.action("read")).body.event.id, feedback.id);
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
