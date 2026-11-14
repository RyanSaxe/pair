import assert from "node:assert/strict";
import test from "node:test";
import pair from "../../adapters/pi/extension.js";
import { detectWake, identify, wakeRunner } from "../../src/hub/wake.mjs";

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

test("a pi wake reaches the session through pair's extension as a steering message", async (t) => {
  const { handlers, sent } = standInPi();
  // Without this hook, a failed assertion would leave the extension's socket
  // open.
  t.after(() => handlers.session_shutdown({ type: "session_shutdown" }));
  handlers.session_start(
    { type: "session_start" },
    { sessionManager: { getSessionId: () => "pi-session-1" } },
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
  await assert.rejects(wakeRunner(target, line), {
    message: `the agent CLI has exited (ENOENT ${target.socket})`,
  });
});
