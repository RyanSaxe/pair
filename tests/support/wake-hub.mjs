import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before } from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { startHub } from "../../src/hub/server.mjs";
import { settings } from "../../src/shared/settings.mjs";

export let hub, home, sessionId, sessionDir, token;

export const wakes = [];

let wakeFails = false;
export const failWakes = (fail) => {
  wakeFails = fail;
};

export const page = (round, id) =>
  buildPage(path.join(os.tmpdir(), "wake-page.json"), {
    name: "t",
    round,
    title: "T",
    page:
      id === "agreed"
        ? {
            id,
            title: "Agreed so far",
            agreements: [],
            task: { title: "The task", html: "<p>What the plan builds.</p>" },
          }
        : { id, title: "P", html: "<p>x</p>" },
  });

export const post = async (route, body, headers) => {
  const response = await fetch(hub.origin + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.json(),
  };
};

export const act = (data) =>
  post(
    `/agent/${sessionId}/action`,
    { ...data, sessionId, agent: { harness: "codex", id: "thread-1" } },
    { authorization: `Bearer ${token}` },
  );

export const status = async () =>
  (await fetch(`${hub.origin}/s/${sessionId}/api/status`)).json();

export const publishRound = async (round) => {
  const agreed = await act({
    action: "publish",
    html: await page(round, "agreed"),
    pages: [{ id: "p", title: "P" }],
  });
  assert.ok(agreed.ok, JSON.stringify(agreed.body));
  return act({ action: "publish", html: await page(round, "p") });
};

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "plan-progress-"));
  const config = {
    ...settings({ XDG_STATE_HOME: home, PAIR_HUB_PORT: "0" }),
    log() {},
    async wake(target, line) {
      wakes.push({ target, line });
      if (wakeFails) throw new Error("thread gone");
    },
  };
  hub = await startHub(config);
  sessionDir = path.join(home, "session");
  const registered = await post(
    "/agent/register",
    { sessionDir, wake: { harness: "codex", thread: "thread-1" } },
    { authorization: `Bearer ${hub.secret}` },
  );
  assert.deepEqual(registered.body.wake, { harness: "codex" });
  sessionId = registered.body.sessionId;
  token = JSON.parse(
    await fs.readFile(path.join(sessionDir, "connection.json"), "utf8"),
  ).token;
  assert.ok((await publishRound("1")).ok);
  const feedback = await post(
    `/s/${sessionId}/api/feedback`,
    {
      sessionId,
      id: "evt1",
      name: "t",
      round: "1",
      intent: "feedback-only",
      groups: { choices: {}, notes: [] },
      text: "hi",
    },
    { origin: hub.origin },
  );
  assert.ok(feedback.ok, JSON.stringify(feedback.body));
});

after(async () => {
  await hub.close();
  await fs.rm(home, { recursive: true, force: true });
});
