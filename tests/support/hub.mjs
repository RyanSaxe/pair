import "./env.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildPage } from "../../src/cli/build.mjs";
import { startHub } from "../../src/hub/server.mjs";
import { settings } from "../../src/shared/settings.mjs";

export const exec = promisify(execFile);

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const pair = path.join(root, "src/cli.mjs");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

export const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};

export async function waitUntil(check, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(50);
  }
  return false;
}

export async function killHub(config) {
  try {
    const record = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
    process.kill(record.pid, "SIGTERM");
    await waitUntil(() => !alive(record.pid), 3000);
  } catch {
    /* No hub record, or the hub already exited. */
  }
}

export const sessionConfig = (html) =>
  JSON.parse(html.match(/id="session-config">([\s\S]*?)<\/script>/)[1]);

export function planData(round = "1", offer, name = "example") {
  return {
    name,
    round,
    ...(offer ? { offer } : {}),
    title: "Example work",
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: "<p>Preserve one result per input.</p>",
      },
    ],
  };
}

export async function hub(t, extra = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "plan-hub-"));
  const env = { XDG_STATE_HOME: home, PAIR_HUB_PORT: "0", ...extra };
  // The wake targets the hub woke, in order.
  const wakes = [];
  const config = {
    ...settings(env),
    log() {},
    async wake(target) {
      wakes.push(target);
    },
  };
  const server = await startHub(config);
  t.after(async () => {
    await server.close();
    await killHub(config);
    await fs.rm(home, { recursive: true, force: true });
  });
  const record = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
  // A session is registered by a Codex thread, or by the agent a pairCli
  // runs as, so that the command can work on it.
  async function session(name = crypto.randomUUID(), cli = null) {
    const wake = cli
      ? { harness: "claude-code", socket: cli.agent.id, token: "test" }
      : { harness: "codex", thread: `thread-${name}` };
    const agent = cli ? cli.agent : { harness: "codex", id: wake.thread };
    const directory = path.join(config.sessions, name);
    const registered = await fetch(server.origin + "/agent/register", {
      method: "POST",
      headers: {
        authorization: `Bearer ${record.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionDir: directory, wake }),
    });
    const info = await registered.json();
    assert.equal(registered.status, 200, info.error);
    const connection = JSON.parse(
      await fs.readFile(path.join(directory, "connection.json"), "utf8"),
    );
    const id = info.sessionId;
    const request = async (route, data, headers = {}) => {
      const response = await fetch(server.origin + route, {
        method: data ? "POST" : "GET",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          ...(route.startsWith("/agent/")
            ? { authorization: `Bearer ${connection.token}` }
            : { Origin: server.origin }),
          ...headers,
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { code: response.status, body, headers: response.headers };
    };
    const action = (action, data = {}, headers) =>
      request(
        `/agent/${id}/action`,
        { action, sessionId: id, agent, ...data },
        headers,
      );
    // A round goes out as an agent sends it: Agreed with the page list,
    // then each page. The result is the first refusal, or the last page's.
    const publish = async (data) => {
      const build = (page) =>
        buildPage(path.join(directory, "source.json"), {
          name: data.name,
          round: data.round,
          offer: data.offer,
          title: data.title,
          page,
        });
      let result = await action("publish", {
        html: await build({
          id: "agreed",
          title: "Agreed so far",
          task: { title: "The task", html: "<p>What the plan builds.</p>" },
          agreements: data.agreements || [],
        }),
        pages: data.pages.map(({ id, title }) => ({ id, title })),
      });
      for (const page of data.pages) {
        if (result.code !== 200) break;
        result = await action("publish", { html: await build(page) });
      }
      return result;
    };
    const event = (intent = "feedback-only", round = "1", extra = {}) => ({
      sessionId: id,
      name: "example",
      round,
      intent,
      id: crypto.randomUUID(),
      groups: {},
      text: "Keep the interface.",
      ...extra,
    });
    return {
      id,
      base: `/s/${id}`,
      directory,
      info,
      connection,
      request,
      action,
      publish,
      event,
      feedback: (data, headers) =>
        request(`/s/${id}/api/feedback`, data, headers),
      status: () => request(`/s/${id}/api/status`),
    };
  }
  return {
    home,
    env: { ...process.env, ...env },
    config,
    server,
    record,
    wakes,
    session,
  };
}
