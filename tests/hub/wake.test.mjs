import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { detectWake } from "../../src/hub/wake.mjs";
import { lifecycle } from "../../src/shared/lifecycle.mjs";
import { threadState } from "../../src/shared/thread-state.mjs";
import { wakeState } from "../../src/shared/wake-state.mjs";
import { hub, pairCli, planData, sleep, waitUntil } from "../support/hub.mjs";

// The hub records a wake's result in the status once the wake has finished,
// and until then the newest send's wake is owed.
const woken = (a) =>
  waitUntil(async () => wakeState((await a.status()).body) !== "owed");

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
  const listed = (await a.request("/api/sessions")).body.sessions;
  assert.equal(listed.find((item) => item.id === a.id).wakeFailed, false);
  assert.equal(view.latestSubmissionRound, "1");
  assert.deepEqual(a.inbox.wakes, [
    {
      auth: { type: "auth", token: a.inbox.token },
      message: {
        type: "user",
        message: {
          role: "user",
          content: `pair: the reviewer sent feedback on round 1 of session ${a.directory}. Run pair read --session-dir ${a.directory} first, which prints the feedback and your next step.`,
        },
      },
    },
  ]);
  assert.equal((await a.action("read")).body.event.id, feedback.id);
});

test("a hub with PAIR_WAKE=off records the wake as sent and sends nothing", async (t) => {
  const h = await hub(t, { PAIR_WAKE: "off" });
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal(await woken(a), true);
  assert.equal((await a.status()).body.wake.last.ok, true);
  assert.deepEqual(a.inbox.wakes, []);
});

test("a failed wake is recorded until the holder runs a command, and the submission stays readable", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  // Closing the inbox stands in for an agent session that has ended.
  await a.inbox.close();
  const feedback = a.event();
  assert.equal((await a.feedback(feedback)).code, 200);
  assert.equal(await woken(a), true);
  const { wake } = (await a.status()).body;
  assert.equal(wake.last.ok, false);
  assert.ok(wake.last.reason.includes(a.inbox.socket), wake.last.reason);
  const failed = async () =>
    (await a.request("/api/sessions")).body.sessions.find(
      (item) => item.id === a.id,
    ).wakeFailed;
  assert.equal(await failed(), true);
  // Any agent can run pair status, and the failure stays until the holder
  // runs a command.
  const other = { harness: "claude-code", id: path.join(h.home, "other.sock") };
  assert.equal((await a.action("status", { agent: other })).code, 200);
  assert.equal(await failed(), true);
  assert.equal((await a.action("read")).body.event.id, feedback.id);
  assert.equal(await failed(), false);
  assert.equal(wakeState((await a.status()).body), "answered");
  // pair start from the holder clears a failed wake too.
  assert.equal((await a.publish(planData("2"))).code, 200);
  assert.equal((await a.feedback(a.event("feedback-only", "2"))).code, 200);
  assert.equal(await woken(a), true);
  assert.equal(await failed(), true);
  const started = await h.register(a.directory, a.inbox.target, {
    start: true,
  });
  assert.equal(started.code, 200, started.body.error);
  assert.equal(await failed(), false);
});

// pi, opencode and Copilot keep their identity when they restart, and then
// listen on a new socket or port. pairCli runs the command as Claude Code,
// whose identity is its socket, so this session starts with another token,
// the rest of a Claude Code wake target.
test("the hub wakes the holder at the wake target its latest command sent", async (t) => {
  const h = await hub(t);
  const box = await h.inbox();
  const a = await h.session({
    box: { ...box, target: { ...box.target, token: "before-restart" } },
  });
  assert.equal((await a.publish(planData())).code, 200);
  const root = path.join(h.home, "cli");
  await fs.mkdir(root);
  const cli = await pairCli(root, {
    XDG_STATE_HOME: h.home,
    PAIR_HUB_PORT: "0",
    CLAUDE_CODE_MESSAGING_SOCKET: box.socket,
    CLAUDE_CODE_MESSAGING_TOKEN: box.token,
  });
  await cli.run("status", "--session-dir", a.directory);
  const saved = JSON.parse(
    await fs.readFile(path.join(a.directory, "wake.json"), "utf8"),
  );
  assert.equal(saved.token, box.token);
  assert.equal(
    JSON.stringify((await a.status()).body).includes(box.token),
    false,
  );
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal(await woken(a), true);
  assert.deepEqual(
    box.wakes.map((wake) => wake.auth.token),
    [box.token],
  );
});

// A command that finds no hub registers the session with a new hub, and only
// pair start resumes a paused session. The hub holds the wake for feedback,
// for a new thread and for a message in a thread whose wake went out before
// the pause, and pair start's next step names each thread instead.
test("a paused session is not woken until its agent runs pair start", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const startThread = async () => {
    const started = await a.request(`${a.base}/api/threads`, {
      id: crypto.randomUUID(),
      round: "1",
      topic: "overview",
      anchor: "Failure handling",
      text: "What happens to a failed item?",
    });
    assert.equal(started.code, 201, started.body.error);
    return started.body.thread.id;
  };
  const send = (id, text) =>
    a.request(`${a.base}/api/threads/${id}/messages`, { text });
  // The frame works out each thread's state from the thread and the status.
  const states = async () => {
    const status = (await a.status()).body;
    return status.threads.map((thread) =>
      threadState(thread, lifecycle(status)),
    );
  };
  const before = await startThread();
  assert.equal(await waitUntil(() => a.inbox.wakes.length === 1), true);
  assert.equal((await a.action("pause")).code, 400);
  assert.equal(
    (await a.action("pause", { reason: "asked to stop" })).code,
    200,
  );
  const feedback = a.event();
  assert.equal((await a.feedback(feedback)).code, 200);
  const during = await startThread();
  assert.equal((await send(before, "Or a retry?")).code, 201);
  await sleep(100);
  assert.equal(a.inbox.wakes.length, 1);
  assert.deepEqual(await states(), ["held", "held"]);
  assert.equal((await h.register(a.directory, a.inbox.target)).code, 200);
  assert.equal((await a.status()).body.paused.reason, "asked to stop");
  const resumed = await h.register(a.directory, a.inbox.target, {
    start: true,
  });
  assert.equal(resumed.code, 200, resumed.body.error);
  assert.ok(
    resumed.body.next.includes(
      `You have not answered the reviewer's threads ${before} on "Overview" and ${during} on "Overview".`,
    ),
    resumed.body.next,
  );
  assert.deepEqual(await states(), ["sent", "sent"]);
  assert.equal((await a.status()).body.paused, null);
  assert.equal((await a.action("read")).body.event.id, feedback.id);
  assert.equal((await send(during, "And refunds?")).code, 201);
  assert.equal(await waitUntil(() => a.inbox.wakes.length === 2), true);
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
  // Codex records its daemon's socket under CODEX_HOME.
  const codex = { CODEX_THREAD_ID: "t", CODEX_HOME: "/c" };
  const codexTarget = {
    harness: "codex",
    thread: "t",
    socket: path.join("/c", "app-server-control", "app-server-control.sock"),
  };
  assert.deepEqual(
    detectWake(codex, tools([{ pid: 3, command: "codex" }])),
    codexTarget,
  );
  assert.deepEqual(
    detectWake(
      { COPILOT_AGENT_SESSION_ID: "s" },
      tools([{ pid: 3, command: "copilot" }]),
    ),
    { harness: "copilot", sessionId: "s", port: 4321, sdk: "/sdk/index.js" },
  );
  assert.deepEqual(
    detectWake(codex, tools([{ pid: 2, command: "sh" }])),
    codexTarget,
  );
  // tests/adapters/pi.test.mjs and tests/adapters/opencode.test.mjs check the
  // targets of pi and opencode with the variables their extensions set.
});

const extension = fileURLToPath(
  new URL("../../adapters/pi/extension.js", import.meta.url),
);

test("start refuses without a wake path and says what to do", () => {
  assert.throws(() => detectWake({}, tools([])), {
    message:
      "pair found no agent CLI it can wake. It works inside Claude Code, Codex, Copilot CLI, pi or opencode, and none of their session variables is set here. Tell the user, and stop.",
  });
  // detectWake refuses a pi session without pair's extension, whether it finds
  // pi among the ancestors or, with no agent CLI among them, by PAIR_PI_SOCKET.
  const pi = {
    message: `Ask the user to run \`pi install ${extension}\` and restart pi with \`pi --continue\`, then run \`pair start\` again. This pi session runs without pair's extension, so the hub cannot wake it.`,
  };
  assert.throws(() => detectWake({}, tools([{ pid: 3, command: "pi" }])), pi);
  assert.throws(
    () => detectWake({ PAIR_PI_SOCKET: "/tmp/pair-1/wake.sock" }, tools([])),
    pi,
  );
  // tests/adapters/opencode.test.mjs checks the config file in this error
  // message.
  assert.throws(
    () =>
      detectWake(
        { PAIR_OPENCODE_SOCKET: "/tmp/pair-2/wake.sock" },
        tools([{ pid: 3, command: "opencode" }]),
      ),
    /This opencode session runs without pair's plugin/,
  );
  assert.throws(
    () =>
      detectWake(
        { COPILOT_AGENT_SESSION_ID: "s" },
        tools([{ pid: 3, command: "copilot" }], null),
      ),
    /copilot --ui-server --resume s`, then run `pair start` again/,
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
