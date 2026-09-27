import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { startHub } from "../../src/hub/server.mjs";
import { settings, version } from "../../src/shared/settings.mjs";
import {
  alive,
  exec,
  exists,
  hub,
  killHub,
  pair,
  waitUntil,
} from "../support/hub.mjs";
import { agent, home } from "../support/page-hub.mjs";
import { pairCli } from "../support/pair-cli.mjs";

test("capability check tests storage, loopback, and the hub port, then cleans up", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "plan-check-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const result = await exec(process.execPath, [pair, "check", directory], {
    env: { ...process.env, PAIR_HUB_PORT: "0" },
  });
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, true);
  assert.equal(report.hub.state, "os-assigned");
  assert.deepEqual(await fs.readdir(directory), []);
  const h = await hub(t);
  const live = JSON.parse(
    (
      await exec(process.execPath, [pair, "check", directory], {
        env: { ...process.env, PAIR_HUB_PORT: String(h.record.port) },
      })
    ).stdout,
  );
  assert.equal(live.hub.state, "hub");
  assert.equal(live.hub.version, version);
  const file = path.join(directory, "not-a-directory");
  await fs.writeFile(file, "preserve");
  await assert.rejects(exec(process.execPath, [pair, "check", file]));
  assert.equal(await fs.readFile(file, "utf8"), "preserve");
});

test("the hub exits when nothing is live and start spawns a fresh one on the same port", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "plan-idle-"));
  const port = 30000 + Math.floor(Math.random() * 20000);
  // Each new hub starts with no live session and waits this long for start
  // to register one, which can take over 300ms on a busy machine.
  const { config, run } = await pairCli(home, {
    PAIR_HUB_PORT: String(port),
    PAIR_HUB_IDLE_SECONDS: "1",
  });
  t.after(async () => {
    await killHub(config);
    await fs.rm(home, { recursive: true, force: true });
  });
  const first = JSON.parse(await run("start"));
  assert.equal(first.url, `http://127.0.0.1:${port}/s/${first.sessionId}/`);
  assert(first.sessionDir.startsWith(config.sessions));
  // The printed wake names the harness and carries none of the token or
  // thread it wakes with.
  assert.deepEqual(first.wake, { harness: "claude-code" });
  const record = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
  assert.equal(record.port, port);
  assert.equal(record.version, version);
  // A session stays live until it completes or pauses, so the hub exits only
  // once this one is paused.
  await run("pause", "--session-dir", first.sessionDir, "--reason", "idle");
  assert.equal(await waitUntil(() => !alive(record.pid), 5000), true);
  assert.equal(await exists(config.hubFile), false);
  const second = JSON.parse(
    await run("start", "--session-dir", first.sessionDir),
  );
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.url, first.url);
  const next = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
  assert.notEqual(next.pid, record.pid);
  assert.equal(next.port, port);
  assert.match(
    await fs.readFile(config.hubLog, "utf8"),
    /no live sessions; exiting/,
  );
});

test("start waits for a new hub to load the saved sessions", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-saved-"));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const { config, run } = await pairCli(home, {
    PAIR_HUB_PORT: String(port),
  });
  t.after(async () => {
    await killHub(config);
    await fs.rm(home, { recursive: true, force: true });
  });
  // A new hub answers on its port before it has loaded these, which takes
  // it a few hundred milliseconds.
  await Promise.all(
    Array.from({ length: 400 }, async () => {
      const sessionId = crypto.randomUUID();
      const directory = path.join(config.sessions, sessionId);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(
        path.join(directory, "status.json"),
        JSON.stringify({
          sessionId,
          stage: "ready",
          current: null,
          acknowledged: [],
          accepted: null,
          updatedAt: new Date().toISOString(),
        }),
      );
    }),
  );
  const start = async () => JSON.parse(await run("start"));
  // The first start spawns the hub. The second arrives while it loads.
  const first = start();
  assert.equal(
    await waitUntil(() =>
      fetch(`http://127.0.0.1:${port}/api/hub`).then(
        () => true,
        () => false,
      ),
    ),
    true,
  );
  for (const session of await Promise.all([first, start()]))
    assert.equal(
      session.url,
      `http://127.0.0.1:${port}/s/${session.sessionId}/`,
    );
});

test("the Codex network check installs rules and reports sandbox state", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "plan-codex-"));
  t.after(() => fs.rm(codexHome, { recursive: true, force: true }));
  await exec(process.execPath, [pair, "check", "--codex-rules"], {
    env: { ...h.env, CODEX_HOME: codexHome },
  });
  const rules = await fs.readFile(
    path.join(codexHome, "rules", "pair.rules"),
    "utf8",
  );
  assert.equal(
    rules,
    'prefix_rule(pattern=["pair"], decision="allow", justification="pair: the command talks to its local hub and writes the session under the state directory")\n',
  );
  const report = JSON.parse(
    (
      await exec(process.execPath, [pair, "check", a.directory], {
        env: { ...h.env, CODEX_HOME: codexHome, CODEX_SANDBOX: "seatbelt" },
      })
    ).stdout,
  );
  assert.equal(report.codex.present, true);
});

test("start replaces a stale hub record, and helper commands reattach after a crash without losing the queue", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "plan-stale-"));
  const { config, run } = await pairCli(home, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(home, { recursive: true, force: true });
  });
  const dead = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => dead.once("exit", resolve));
  await fs.mkdir(config.hubDir, { recursive: true });
  await fs.writeFile(
    config.hubFile,
    JSON.stringify({
      pid: dead.pid,
      port: 1,
      hosts: ["127.0.0.1"],
      version,
      startedAt: "2000-01-01T00:00:00Z",
      secret: "stale",
    }),
  );
  const started = JSON.parse(await run("start"));
  const record = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
  assert.notEqual(record.pid, dead.pid);
  assert.notEqual(record.port, 1);
  const source = path.join(home, "source.json");
  const shared = {
    name: "example",
    round: "1",
    title: "Example work",
  };
  const command = (...args) =>
    run(...args, "--session-dir", started.sessionDir);
  const agreedFile = path.join(home, "agreed.html");
  await fs.writeFile(
    agreedFile,
    await buildPage(source, {
      ...shared,
      page: {
        id: "agreed",
        title: "Agreed so far",
        agreements: [],
        task: { title: "The task", html: "<p>What the plan builds.</p>" },
      },
    }),
  );
  const pagesFile = path.join(home, "pages.json");
  await fs.writeFile(
    pagesFile,
    JSON.stringify({ pages: [{ id: "overview", title: "Overview" }] }),
  );
  await command("publish", "--file", agreedFile, "--pages", pagesFile);
  const overviewFile = path.join(home, "overview.html");
  await fs.writeFile(
    overviewFile,
    await buildPage(source, {
      ...shared,
      page: { id: "overview", title: "Overview", html: "<p>Ready</p>" },
    }),
  );
  await command("publish", "--file", overviewFile);
  const origin = `http://127.0.0.1:${record.port}`;
  const event = {
    sessionId: started.sessionId,
    name: "example",
    round: "1",
    intent: "feedback-only",
    id: crypto.randomUUID(),
    groups: {},
    text: "Survive a restart",
  };
  const receipt = await fetch(`${origin}/s/${started.sessionId}/api/feedback`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  assert.equal(receipt.status, 200);
  process.kill(record.pid, "SIGKILL");
  assert.equal(await waitUntil(() => !alive(record.pid)), true);
  const output = JSON.parse(await command("read"));
  assert.deepEqual(output.event.payload, event);
  const next = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
  assert.notEqual(next.pid, record.pid);
  const connection = JSON.parse(
    await fs.readFile(path.join(started.sessionDir, "connection.json"), "utf8"),
  );
  assert.equal(connection.sessionId, started.sessionId);
  assert.equal(connection.origin, `http://127.0.0.1:${next.port}`);
});

test("an unfinished round resumes after the hub restarts", async () => {
  const config = {
    ...settings({
      XDG_STATE_HOME: path.join(home, "restart"),
      PAIR_HUB_PORT: "0",
    }),
    log() {},
  };
  let localHub = await startHub(config);
  const localDir = path.join(config.sessions, "session");
  const call = async (action, body) => {
    const response = await fetch(`${localHub.origin}${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${body.auth}`,
      },
      body: JSON.stringify(body.payload),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const joined = await call("/agent/register", {
      auth: localHub.secret,
      payload: {
        sessionDir: localDir,
        wake: { harness: "codex", thread: "test" },
      },
    });
    const id = joined.body.sessionId;
    const secret = JSON.parse(
      await fs.readFile(path.join(localDir, "connection.json"), "utf8"),
    ).token;
    const action = (payload) =>
      call(`/agent/${id}/action`, {
        auth: secret,
        payload: { ...payload, sessionId: id, agent },
      });
    const build = (page) =>
      buildPage(path.join(localDir, "source.json"), {
        name: "restart",
        round: "1",
        offer: "plan",
        title: "Restart",
        page,
      });
    assert.equal(
      (
        await action({
          action: "publish",
          html: await build({
            id: "agreed",
            title: "Agreed",
            task: { title: "The task", html: "<p>What the plan builds.</p>" },
            agreements: [],
          }),
          pages: [
            { id: "overview", title: "Overview" },
            { id: "detail", title: "Detail" },
          ],
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action({
          action: "publish",
          html: await build({
            id: "overview",
            title: "Overview",
            html: "<p>First page</p>",
          }),
        })
      ).status,
      200,
    );
    await localHub.close();
    localHub = await startHub(config);
    const statusAfterRestart = await (
      await fetch(`${localHub.origin}/s/${id}/api/status`)
    ).json();
    assert.equal(statusAfterRestart.openRound.pages[0].state, "ready");
    assert.equal(statusAfterRestart.rounds.length, 0);
    assert.equal(
      (
        await action({
          action: "publish",
          html: await build({
            id: "detail",
            title: "Detail",
            html: "<p>Second page</p>",
          }),
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await fetch(`${localHub.origin}/s/${id}/api/status`)).json())
        .rounds.length,
      1,
    );
  } finally {
    await localHub.close();
  }
});
