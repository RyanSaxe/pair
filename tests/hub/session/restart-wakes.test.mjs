import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../../src/cli/build.mjs";
import { startHub } from "../../../src/hub/server.mjs";
import { threadState } from "../../../src/shared/thread-state.mjs";
import { wakeState } from "../../../src/shared/wake-state.mjs";
import {
  alive,
  killHub,
  pairCli,
  task,
  waitUntil,
} from "../../support/hub.mjs";

// A hub stops without waiting for the wakes it scheduled, as when a command on
// newer code replaces it. The stub stands in for a slow agent CLI: it keeps the
// first wake's connection open, so the hub stops during that wake, and it
// answers every later wake at once. On Windows, where the stub would listen
// on a named pipe, the hub's wake can finish while the stub holds the pipe
// open, so the wake can go out before the hub stops.
const skip =
  process.platform === "win32" &&
  "the stub cannot keep a wake in progress on a Windows named pipe";

// stoppedHub starts a hub as its own process with pair start, and publishes
// round 1 on the agent's route, as pair publish does. stop waits for the first
// wake to reach the stub, stops that hub during the wake, and starts the next
// hub in the test process.
async function stoppedHub(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-owed-"));
  const socket = path.join(home, "agent.sock");
  const wakes = [];
  const stub = net.createServer({ allowHalfOpen: true }, (client) => {
    let text = "";
    client.on("error", () => {});
    client.on("data", (chunk) => (text += chunk));
    client.on("end", () => {
      wakes.push(JSON.parse(text.trim().split("\n")[1]).message.content);
      if (wakes.length > 1) client.end();
    });
  });
  await new Promise((resolve) => stub.listen(socket, resolve));
  stub.unref();
  const { config, agent, start } = await pairCli(home, {
    PAIR_HUB_PORT: "0",
    PAIR_HUB_HOST: "",
    CLAUDE_CODE_MESSAGING_SOCKET: socket,
    CLAUDE_CODE_MESSAGING_TOKEN: "test",
  });
  t.after(async () => {
    await killHub(config);
    stub.close();
    await fs.rm(home, { recursive: true, force: true });
  });
  const { sessionId, sessionDir } = await start();
  const first = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
  let origin = `http://127.0.0.1:${first.port}`;
  const { token } = JSON.parse(
    await fs.readFile(path.join(sessionDir, "connection.json"), "utf8"),
  );
  const act = async (action, data) => {
    const response = await fetch(`${origin}/agent/${sessionId}/action`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, sessionId, agent, ...data }),
    });
    assert.equal(response.status, 200, (await response.json()).error);
  };
  const publish = async (page, pages) =>
    act("publish", {
      html: await buildPage(path.join(sessionDir, "source.json"), {
        name: "owed",
        round: "1",
        title: "Owed",
        page,
      }),
      pages,
    });
  await publish(
    { id: "agreed", title: "Agreed so far", agreements: [], task },
    [{ id: "overview", title: "Overview" }],
  );
  await publish({ id: "overview", title: "Overview", html: "<p>One</p>" });
  const post = (route, data) =>
    fetch(`${origin}/s/${sessionId}/api/${route}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const status = async () =>
    (await fetch(`${origin}/s/${sessionId}/api/status`)).json();
  async function stop() {
    assert.equal(await waitUntil(() => wakes.length === 1), true);
    process.kill(first.pid, "SIGTERM");
    assert.equal(await waitUntil(() => !alive(first.pid)), true);
    const next = await startHub({ ...config, log() {} });
    t.after(() => next.close());
    origin = next.origin;
    assert.equal(await waitUntil(() => wakes.length === 2), true);
    assert.equal(wakes[1], wakes[0]);
  }
  return { act, sessionId, sessionDir, wakes, post, status, stop };
}

test(
  "the next hub sends the wake of a thread that a stopped hub left sending",
  { skip },
  async (t) => {
    const { sessionDir, wakes, post, status, stop } = await stoppedHub(t);
    const id = crypto.randomUUID();
    const thread = { id, round: "1", topic: "overview", anchor: "One" };
    const opened = await post("threads", { ...thread, text: "First message" });
    assert.equal(opened.status, 201);
    assert.equal(await waitUntil(() => wakes.length === 1), true);
    const saved = JSON.parse(
      await fs.readFile(path.join(sessionDir, "threads", `${id}.json`), "utf8"),
    );
    assert.equal(threadState(saved), "sending");
    await stop();
    const state = async () =>
      threadState((await status()).threads.find((item) => item.id === id));
    assert.equal(await waitUntil(async () => (await state()) === "sent"), true);
    const added = await post(`threads/${id}/messages`, {
      text: "Second message",
    });
    assert.equal(added.status, 201);
    assert.equal(await waitUntil(() => wakes.length === 3), true);
    assert.match(wakes[2], /Second message$/);
  },
);

// The reviewer's feedback and a Start each wake the holder after the hub saves
// them, and the next hub sends the wake that a stopped hub owed.
for (const [kind, send, line] of [
  [
    "feedback",
    async ({ post, sessionId }) => {
      const sent = await post("feedback", {
        sessionId,
        name: "owed",
        round: "1",
        intent: "feedback-only",
        id: crypto.randomUUID(),
        groups: {},
        text: "Keep the interface.",
      });
      assert.equal(sent.status, 200);
    },
    /^pair: the reviewer sent feedback on round 1 of session /,
  ],
  [
    "a Start",
    async ({ act, post }) => {
      await act("propose", {
        id: "docs-pass",
        title: "Docs pass",
        delivers: "Docs match the code.",
        recommend: "here",
      });
      const started = await post("proposals/docs-pass/start", {
        where: "here",
      });
      assert.equal(started.status, 200);
    },
    /^pair: the reviewer approved proposal docs-pass, "Docs pass", to run in session /,
  ],
])
  test(
    `the next hub sends the wake for ${kind} that a stopped hub owed`,
    { skip },
    async (t) => {
      const hub = await stoppedHub(t);
      await send(hub);
      await hub.stop();
      assert.match(hub.wakes[0], line);
      assert.equal(
        await waitUntil(async () => wakeState(await hub.status()) === "sent"),
        true,
      );
    },
  );
