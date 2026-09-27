import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startHub } from "../../src/hub/server.mjs";
import { settings } from "../../src/shared/settings.mjs";
import { page } from "../support/wake-hub.mjs";

test("the hub wakes Claude Code through its inbox socket", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pair-inbox-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const received = [];
  const inbox = net.createServer((client) => {
    let text = "";
    client.on("data", (chunk) => (text += chunk));
    client.on("end", () => {
      received.push(text);
      client.end();
    });
  });
  const socket = path.join(root, "inbox.sock");
  await new Promise((resolve) => inbox.listen(socket, resolve));
  t.after(() => inbox.close());
  const claudeHub = await startHub({
    ...settings({ XDG_STATE_HOME: root, PAIR_HUB_PORT: "0" }),
    log() {},
  });
  t.after(() => claudeHub.close());
  const directory = path.join(root, "session");
  const call = async (route, body, headers) =>
    (
      await fetch(claudeHub.origin + route, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      })
    ).json();
  const { sessionId: id } = await call(
    "/agent/register",
    {
      sessionDir: directory,
      wake: { harness: "claude-code", socket, token: "tok" },
    },
    { authorization: `Bearer ${claudeHub.secret}` },
  );
  const holder = { harness: "claude-code", id: socket };
  const agent = {
    authorization: `Bearer ${
      JSON.parse(
        await fs.readFile(path.join(directory, "connection.json"), "utf8"),
      ).token
    }`,
  };
  await call(
    `/agent/${id}/action`,
    {
      sessionId: id,
      agent: holder,
      action: "publish",
      html: await page("1", "agreed"),
      pages: [{ id: "p", title: "P" }],
    },
    agent,
  );
  await call(
    `/agent/${id}/action`,
    {
      sessionId: id,
      agent: holder,
      action: "publish",
      html: await page("1", "p"),
    },
    agent,
  );
  await call(
    `/s/${id}/api/feedback`,
    {
      sessionId: id,
      id: "sent",
      name: "t",
      round: "1",
      intent: "feedback-only",
      groups: { choices: {}, notes: [] },
      text: "hi",
    },
    { origin: claudeHub.origin },
  );
  let view;
  for (let i = 0; i < 50 && !view?.wake?.last; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    view = await (await fetch(`${claudeHub.origin}/s/${id}/api/status`)).json();
  }
  assert.equal(view.wake.last.ok, true);
  const [auth, message] = received[0]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(auth, { type: "auth", token: "tok" });
  assert.deepEqual(message, {
    type: "user",
    message: {
      role: "user",
      content: `pair: feedback arrived on session ${directory} (Round 1). Run first: pair ack --session-dir ${directory}. It prints the next step.`,
    },
  });
});
