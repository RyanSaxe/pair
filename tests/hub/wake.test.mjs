import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { detectWake } from "../../src/hub/wake.mjs";
import { hub, planData, sleep, waitUntil } from "../support/hub.mjs";

// The hub records a wake's result in the status once the wake has finished.
const woken = (a) =>
  waitUntil(async () => Boolean((await a.status()).body.wake?.last));

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
          content: `pair: the reviewer submitted round 1 of session ${a.directory}. Run first: pair ack --session-dir ${a.directory}. It prints the next step.`,
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
  assert.deepEqual(
    detectWake(
      { PAIR_PI_SOCKET: "/tmp/pair-1/wake.sock", PAIR_PI_SESSION: "p" },
      tools([{ pid: 3, command: "pi" }]),
    ),
    { harness: "pi", socket: "/tmp/pair-1/wake.sock", session: "p" },
  );
  assert.deepEqual(
    detectWake(
      {
        PAIR_OPENCODE_SOCKET: "/tmp/pair-2/wake.sock",
        PAIR_OPENCODE_SESSION: "ses_1",
      },
      tools([{ pid: 3, command: "opencode" }]),
    ),
    { harness: "opencode", socket: "/tmp/pair-2/wake.sock", session: "ses_1" },
  );
});

const extension = fileURLToPath(
  new URL("../../adapters/pi/extension.js", import.meta.url),
);

test("start refuses without a wake path and says what to do", () => {
  assert.throws(() => detectWake({}, tools([])), {
    message:
      "no wake path. This needs Claude Code, Codex, Copilot, pi or opencode, and none of their session variables is set.",
  });
  // pi without pair's extension, found as an ancestor or, with no agent CLI
  // among the ancestors, by its first variable.
  const pi = {
    message: `this pi session runs without pair's extension, so it cannot be woken. Run \`pi install ${extension}\`, restart pi with \`pi --continue\`, and run \`pair start\` again.`,
  };
  assert.throws(() => detectWake({}, tools([{ pid: 3, command: "pi" }])), pi);
  assert.throws(
    () => detectWake({ PAIR_PI_SOCKET: "/tmp/pair-1/wake.sock" }, tools([])),
    pi,
  );
  // tests/adapters/opencode.test.mjs checks the config file the line names.
  assert.throws(
    () =>
      detectWake(
        { PAIR_OPENCODE_SOCKET: "/tmp/pair-2/wake.sock" },
        tools([{ pid: 3, command: "opencode" }]),
      ),
    /^Error: this opencode session runs without pair's plugin/,
  );
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
