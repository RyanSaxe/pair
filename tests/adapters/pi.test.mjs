import assert from "node:assert/strict";
import test from "node:test";
import pair from "../../adapters/pi/extension.js";
import { detectWake, identify, wakeRunner } from "../../src/hub/wake.mjs";
import { inProcessState } from "../support/agents.mjs";
import { waitUntil } from "../support/hub.mjs";

// pi calls an extension's default export with its API. standInPi records the
// handlers that pair's extension registers and each message the extension
// sends. Its sendUserMessage throws as pi's does when pi cannot accept the
// message.
function standInPi() {
  const handlers = {};
  const sent = [];
  pair({
    on: (event, handler) => (handlers[event] = handler),
    sendUserMessage(text, options) {
      if (text === "refuse") throw new Error("pi is shutting down");
      sent.push([text, options]);
    },
  });
  return { handlers, sent };
}

test("pair's extension registers a pi session when it starts, and a wake reaches it as a steering message", async (t) => {
  const { home, agents } = await inProcessState(t);
  const { handlers, sent } = standInPi();
  // Without this hook, a failed assertion would leave the extension's socket
  // open.
  t.after(() => handlers.session_shutdown({ type: "session_shutdown" }));
  handlers.session_start(
    { type: "session_start", reason: "startup" },
    { cwd: home, sessionManager: { getSessionId: () => "pi-session-1" } },
  );
  // This process stands in for pi, and its command is node, as pi's is on
  // Windows, so pair register finds it only by the process ID that the
  // extension passes.
  let listed = [];
  assert.ok(
    await waitUntil(async () => (listed = await agents()).length > 0, 30_000),
    "the extension registered no session",
  );
  assert.deepEqual(
    listed.map(({ id, pid, directory }) => ({ id, pid, directory })),
    [{ id: "pi:pi-session-1", pid: process.pid, directory: home }],
  );
  // detectWake does here what pair start does inside pi: it finds pi among the
  // process's ancestors and reads the variables that the extension exported.
  const target = detectWake(process.env, {
    ancestors: () => [{ pid: 2, command: "pi" }],
  });
  assert.equal(target.session, "pi-session-1");
  assert.deepEqual(identify(target), { harness: "pi", id: "pi-session-1" });
  const line = "pair: the reviewer submitted round 1 of session /s.";
  assert.deepEqual(await wakeRunner(target, line), {
    via: "steer",
    steerable: true,
  });
  assert.deepEqual(sent, [[line, { deliverAs: "steer" }]]);
  await assert.rejects(wakeRunner(target, "refuse"), {
    message: "pi is shutting down",
  });
  handlers.session_shutdown({ type: "session_shutdown" });
  assert.equal(process.env.PAIR_PI_SOCKET, undefined);
  assert.equal(process.env.PAIR_PI_SESSION, undefined);
  assert.equal(process.env.PAIR_PI_PID, undefined);
  await assert.rejects(wakeRunner(target, line), {
    message: `the agent CLI has exited (ENOENT ${target.socket})`,
  });
});
