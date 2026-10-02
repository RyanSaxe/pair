import "./env.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
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

// Text to match exactly inside a regular expression, such as a Windows path,
// whose backslashes would otherwise read as escapes.
export const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

// A port that nothing listens on, for a hub the command spawns on a fixed
// port.
export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// Stops a hub the command spawned. An in-process hub's record has this
// process's own pid, and signalling it would end the test run.
export async function killHub(config) {
  try {
    const record = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
    if (record.pid === process.pid) return;
    process.kill(record.pid, "SIGTERM");
    await waitUntil(() => !alive(record.pid), 3000);
  } catch {
    /* No hub record, or the hub already exited. */
  }
}

export const sessionConfig = (html) =>
  JSON.parse(html.match(/id="session-config">([\s\S]*?)<\/script>/)[1]);

export const task = { title: "The task", html: "<p>What the plan builds.</p>" };

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

// A stand-in for a Claude Code session: a socket the hub wakes the way it
// wakes Claude Code. Each wake arrives as its auth line and its message.
// After close, the next wake fails as a wake to a finished session does.
export async function inbox(t, home) {
  // A socket path must stay under 104 bytes on macOS, so it sits in the
  // hub's home rather than in a session directory. Windows has no socket
  // files, so there it is a named pipe.
  const name = crypto.randomBytes(4).toString("hex");
  const socket =
    process.platform === "win32"
      ? `\\\\.\\pipe\\pair-inbox-${name}`
      : path.join(home, `${name}.sock`);
  const token = crypto.randomUUID();
  const wakes = [];
  const server = net.createServer((client) => {
    let text = "";
    client.on("data", (chunk) => (text += chunk));
    client.on("end", () => {
      const [auth, message] = text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      wakes.push({ auth, message });
      client.end();
    });
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  const close = () => new Promise((resolve) => server.close(() => resolve()));
  t.after(close);
  return {
    socket,
    token,
    wakes,
    close,
    target: { harness: "claude-code", socket, token },
    agent: { harness: "claude-code", id: socket },
  };
}

// An in-process hub on a port the OS assigns, in a home of its own. Every
// session registers with its own inbox, so a test sees only its own wakes.
// options replace settings that no environment variable sets.
export async function hub(t, extra = {}, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-hub-"));
  const env = { XDG_STATE_HOME: home, PAIR_HUB_PORT: "0", ...extra };
  const config = { ...settings(env), log() {}, ...options };
  const server = await startHub(config);
  t.after(async () => {
    await server.close();
    await killHub(config);
    await fs.rm(home, { recursive: true, force: true });
  });
  const record = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
  const register = async (sessionDir, wake, options = {}) => {
    const response = await fetch(server.origin + "/agent/register", {
      method: "POST",
      headers: {
        authorization: `Bearer ${record.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionDir, wake, ...options }),
    });
    return { code: response.status, body: await response.json() };
  };
  // A session registered by an inbox, or by the agent a pairCli runs as,
  // so that the command can work on it. With start, it registers as pair
  // start does.
  async function session({ cli, box, start } = {}) {
    const mailbox = cli ? null : box || (await inbox(t, home));
    const wake = cli
      ? { harness: "claude-code", socket: cli.agent.id, token: "test" }
      : mailbox.target;
    const agent = cli ? cli.agent : mailbox.agent;
    const directory = path.join(config.sessions, crypto.randomUUID());
    const registered = await register(directory, wake, start ? { start } : {});
    assert.equal(registered.code, 200, registered.body.error);
    const info = registered.body;
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
    // With only, the pages it names go out and the round stays open.
    const publish = async (data, { only } = {}) => {
      const build = (page) =>
        buildPage(path.join(directory, "source.json"), {
          name: data.name,
          round: data.round,
          ...(page.id === "agreed" ? { offer: data.offer } : {}),
          title: data.title,
          page,
        });
      let result = await action("publish", {
        html: await build({
          id: "agreed",
          title: "Agreed so far",
          task,
          agreements: data.agreements || [],
        }),
        pages: data.pages.map(({ id, title }) => ({ id, title })),
      });
      for (const page of data.pages) {
        if (only && !only.includes(page.id)) continue;
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
      inbox: mailbox,
      agent,
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
    register,
    inbox: () => inbox(t, home),
    session,
  };
}

// pair takes its wake target and its identity from the nearest agent CLI
// among its ancestors. These commands run under a process named claude whose
// inbox socket nobody listens on, so a test wake reaches no real session, and
// the suite passes the same way under Claude Code, Codex, Copilot CLI or none
// of them.
export async function pairCli(home, extra = {}, cli = pair) {
  const relay =
    'const { status } = require("node:child_process").spawnSync(process.execPath, process.argv.slice(1), { stdio: "inherit" }); process.exitCode = status ?? 1;';
  // Windows runs only a file with an executable extension.
  const claude = path.join(
    home,
    process.platform === "win32" ? "claude.exe" : "claude",
  );
  await fs.symlink(process.execPath, claude);
  const env = {
    ...process.env,
    XDG_STATE_HOME: home,
    CLAUDE_CODE_MESSAGING_SOCKET: path.join(home, "none.sock"),
    CLAUDE_CODE_MESSAGING_TOKEN: "test",
    ...extra,
  };
  const run = async (...args) =>
    (await exec(claude, ["-e", relay, cli, ...args], { env })).stdout;
  return {
    config: settings(env),
    run,
    agent: { harness: "claude-code", id: env.CLAUDE_CODE_MESSAGING_SOCKET },
  };
}
