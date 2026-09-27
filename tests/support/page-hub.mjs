import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before } from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { startHub } from "../../src/hub/server.mjs";
import { settings } from "../../src/shared/settings.mjs";

export let hub, home, directory, sessionId, token;

export const post = async (route, body, headers = {}) => {
  const response = await fetch(hub.origin + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

// Every session in this file is registered with this Codex thread.
export const agent = { harness: "codex", id: "test" };

export const act = (body) =>
  post(
    `/agent/${sessionId}/action`,
    { ...body, sessionId, agent },
    { authorization: `Bearer ${token}` },
  );

export const status = async () =>
  (await fetch(`${hub.origin}/s/${sessionId}/api/status`)).json();

export const page = async (round, id, title, html, extra = {}) =>
  buildPage(path.join(directory, "source.json"), {
    name: "page-test",
    round,
    offer: "plan",
    title: "Page test",
    page: {
      id,
      title,
      ...(id === "agreed"
        ? {
            agreements: [],
            task: { title: "The task", html: "<p>What the plan builds.</p>" },
          }
        : { html }),
      ...extra,
    },
  });

export const publish = async (round, id, title, html, extra, pages) =>
  act({
    action: "publish",
    html: await page(round, id, title, html, extra),
    ...(pages ? { pages } : {}),
  });

export const firstPages = [
  { id: "overview", title: "Overview" },
  { id: "detail", title: "Detail" },
];

export const firstAgreements = [
  { id: "alpha", title: "Alpha", html: "<p>Same</p>", source: "Conversation" },
  { id: "beta", title: "Beta", html: "<p>Before</p>", source: "Conversation" },
];

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "page-round-"));
  hub = await startHub({
    ...settings({ XDG_STATE_HOME: home, PAIR_HUB_PORT: "0" }),
    log() {},
    async wake() {},
  });
  directory = path.join(home, "session");
  const registered = await post(
    "/agent/register",
    {
      sessionDir: directory,
      wake: { harness: "codex", thread: "test" },
    },
    { authorization: `Bearer ${hub.secret}` },
  );
  sessionId = registered.body.sessionId;
  token = JSON.parse(
    await fs.readFile(path.join(directory, "connection.json"), "utf8"),
  ).token;
});

after(async () => {
  if (hub) await hub.close();
  await fs.rm(home, { recursive: true, force: true });
});
