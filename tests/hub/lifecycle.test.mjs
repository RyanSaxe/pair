import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { startHub } from "../../src/hub/server.mjs";
import { version } from "../../src/shared/settings.mjs";
import {
  alive,
  exec,
  exists,
  freePort,
  hub,
  killHub,
  pair,
  pairCli,
  planData,
  task,
  waitUntil,
} from "../support/hub.mjs";

test("capability check tests storage, loopback, and the hub port, then cleans up", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-check-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const check = async (env) =>
    JSON.parse(
      (
        await exec(process.execPath, [pair, "check", "--json"], {
          env: { ...process.env, XDG_STATE_HOME: directory, ...env },
        })
      ).stdout,
    );
  const report = await check({ PAIR_HUB_PORT: "0" });
  assert.equal(report.ready, true);
  assert.equal(report.hub.state, "os-assigned");
  // check tests the directory the hub writes to, not XDG_STATE_HOME itself.
  assert.equal(report.storage, path.join(directory, "pair"));
  assert.deepEqual(await fs.readdir(path.join(directory, "pair")), []);
  const h = await hub(t);
  const live = await check({
    XDG_STATE_HOME: h.home,
    PAIR_HUB_PORT: String(h.record.port),
  });
  assert.equal(live.hub.state, "hub");
  assert.equal(live.hub.version, version);
  const file = path.join(directory, "not-a-directory");
  await fs.writeFile(file, "preserve");
  await assert.rejects(
    exec(process.execPath, [pair, "check"], {
      env: { ...process.env, XDG_STATE_HOME: file, PAIR_HUB_PORT: "0" },
    }),
  );
  assert.equal(await fs.readFile(file, "utf8"), "preserve");
});

// Before closedAt, the hub stored the round's stage, and Close set it to
// "complete" with the time in dismissedAt. A reopen set dismissedAt to null and
// stored the stage again.
test("a closed session stays closed after the hub restarts, and one an older hub closed or reopened loads with closedAt", async (t) => {
  const h = await hub(t);
  const closedNow = await h.session(),
    closedBefore = await h.session(),
    reopenedBefore = await h.session();
  await closedNow.publish(planData());
  await closedBefore.publish(planData());
  await reopenedBefore.publish(planData());
  assert.equal((await closedNow.feedback(closedNow.event())).code, 200);
  assert.equal(
    (await closedNow.request(`${closedNow.base}/api/dismiss`, {})).code,
    200,
  );
  await h.server.close();
  const at = "2026-11-01T12:00:00.000Z";
  const rewrite = async (session, fields) => {
    const file = path.join(session.directory, "status.json");
    const { closedAt, ...state } = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.writeFile(file, JSON.stringify({ ...state, ...fields }));
  };
  await rewrite(closedBefore, { stage: "complete", dismissedAt: at });
  await rewrite(reopenedBefore, { stage: "updated", dismissedAt: null });
  const restarted = await startHub(h.config);
  try {
    const get = async (route) => (await fetch(restarted.origin + route)).json();
    const unread = await get(`${closedNow.base}/api/status`);
    assert.equal(typeof unread.closedAt, "string");
    assert.equal(unread.stage, "submitted");
    const closed = await get(`${closedBefore.base}/api/status`);
    assert.equal(closed.closedAt, at);
    assert.equal(closed.stage, "updated");
    assert.equal(
      (await get(`${reopenedBefore.base}/api/status`)).closedAt,
      null,
    );
    assert.deepEqual(
      (await get("/api/sessions")).sessions.map(({ id }) => id),
      [reopenedBefore.id],
    );
    const stored = JSON.parse(
      await fs.readFile(
        path.join(closedBefore.directory, "status.json"),
        "utf8",
      ),
    );
    assert.equal(stored.closedAt, at);
    assert.equal("stage" in stored || "dismissedAt" in stored, false);
  } finally {
    await restarted.close();
  }
});

// A command that replaces the hub stops it while a pair command or a Send can be
// in progress. A browser also opens connections before it sends a request on
// them, and the hub must not wait for those.
test("a request in progress when the hub shuts down gets its answer, and a connection with no request does not hold the shutdown", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const { port } = new URL(h.server.origin);
  const unused = net.connect(port, "127.0.0.1");
  t.after(() => unused.destroy());
  await new Promise((resolve) => unused.once("connect", resolve));
  const body = JSON.stringify(a.event());
  const request = http.request(`${h.server.origin}${a.base}/api/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      Origin: h.server.origin,
      Expect: "100-continue",
    },
  });
  const response = new Promise((resolve, reject) => {
    request.once("error", reject);
    request.once("response", (reply) => resolve(reply.statusCode));
  });
  // The hub answers 100 Continue once it has the request's headers, so the
  // request is in progress when the shutdown starts.
  request.flushHeaders();
  await new Promise((resolve) => request.once("continue", resolve));
  const closing = h.server.close();
  request.end(body);
  assert.equal(await response, 200);
  const answered = Date.now();
  await closing;
  assert(Date.now() - answered < 1000, "the shutdown waited for a connection");
});

test("the hub exits when nothing is live and start spawns a fresh one on the same port", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-idle-"));
  const port = await freePort();
  // PAIR_HUB_IDLE_SECONDS is 1 because a new hub exits after that long with no
  // live session, and on a busy machine start can take over 300 ms to register
  // one.
  const { config, run, start } = await pairCli(home, {
    PAIR_HUB_PORT: String(port),
    PAIR_HUB_IDLE_SECONDS: "1",
  });
  t.after(async () => {
    await killHub(config);
    await fs.rm(home, { recursive: true, force: true });
  });
  const first = await start();
  assert.equal(first.url, `http://127.0.0.1:${port}/s/${first.sessionId}/`);
  assert(first.sessionDir.startsWith(config.sessions));
  // start --json prints only the harness of the wake target, never the token or
  // thread that the hub wakes the agent with.
  assert.deepEqual(first.wake, { harness: "claude-code" });
  const record = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
  assert.equal(record.port, port);
  assert.equal(record.version, version);
  // The hub counts a session as live until it completes or pauses, so the test
  // pauses it to let the hub exit.
  await run("pause", "--session-dir", first.sessionDir, "--reason", "idle");
  assert.equal(await waitUntil(() => !alive(record.pid), 5000), true);
  assert.equal(await exists(config.hubFile), false);
  const second = JSON.parse(
    await run("start", "--session-dir", first.sessionDir, "--json"),
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
  const port = await freePort();
  const { config, start } = await pairCli(home, {
    PAIR_HUB_PORT: String(port),
  });
  t.after(async () => {
    await killHub(config);
    await fs.rm(home, { recursive: true, force: true });
  });
  // A new hub answers on its port before it has loaded these 400 sessions,
  // which takes it a few hundred milliseconds.
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
          updatedAt: new Date().toISOString(),
        }),
      );
    }),
  );
  // The first start spawns the hub, and the second runs while the hub is still
  // loading sessions.
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

test("start replaces a stale hub record, and session commands reattach after a crash without losing the queue", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-stale-"));
  const { config, run, start } = await pairCli(home, { PAIR_HUB_PORT: "0" });
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
  const started = await start();
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
        task,
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
  const output = JSON.parse(await command("read", "--json"));
  assert.deepEqual(output.event.payload, event);
  const next = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
  assert.notEqual(next.pid, record.pid);
  const connection = JSON.parse(
    await fs.readFile(path.join(started.sessionDir, "connection.json"), "utf8"),
  );
  assert.equal(connection.sessionId, started.sessionId);
  assert.equal(connection.origin, `http://127.0.0.1:${next.port}`);
});

// Inside Codex's sandbox, no command can reach the hub, though the hub still
// runs. start there must leave the hub's record for the commands outside the
// sandbox and print the instruction to run outside the sandbox.
test(
  "start keeps the record of a hub that runs but does not answer, and names the sandbox under Codex",
  { skip: process.platform === "win32" && "Windows has no SIGSTOP" },
  async (t) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-stopped-"));
    const { config, start } = await pairCli(home, { PAIR_HUB_PORT: "0" });
    await start();
    const record = await fs.readFile(config.hubFile, "utf8");
    const { pid, port } = JSON.parse(record);
    process.kill(pid, "SIGSTOP");
    t.after(async () => {
      process.kill(pid, "SIGCONT");
      process.kill(pid, "SIGTERM");
      await waitUntil(() => !alive(pid));
      await killHub(config);
      await fs.rm(home, { recursive: true, force: true });
    });
    const refusal = `pair: The hub (pid ${pid}) is running but does not answer on port ${port}`;
    await assert.rejects(start(), ({ stderr }) => {
      assert.equal(
        stderr,
        `${refusal}. Run pair guide setup.md and follow it.\n`,
      );
      return true;
    });
    // Codex sets CODEX_SANDBOX for every command it runs.
    await fs.mkdir(path.join(home, "sandbox"));
    const sandboxed = await pairCli(path.join(home, "sandbox"), {
      XDG_STATE_HOME: home,
      PAIR_HUB_PORT: "0",
      CODEX_SANDBOX: "seatbelt",
    });
    await assert.rejects(sandboxed.start(), ({ stderr }) => {
      assert.equal(
        stderr,
        `${refusal} inside the sandbox. Run this command outside the sandbox (escalated), and run \`pair setup-codex\` once so that Codex stops asking.\n`,
      );
      return true;
    });
    assert.equal(await fs.readFile(config.hubFile, "utf8"), record);
  },
);

test("an unfinished round resumes after the hub restarts", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const data = {
    ...planData(),
    pages: [
      { id: "overview", title: "Overview", html: "<p>First page</p>" },
      { id: "detail", title: "Detail", html: "<p>Second page</p>" },
    ],
  };
  assert.equal((await a.publish({ ...data, stopAfter: 1 })).code, 200);
  await h.server.close();
  const next = await startHub(h.config);
  t.after(next.close);
  const status = async () =>
    (await fetch(`${next.origin}${a.base}/api/status`)).json();
  const restarted = await status();
  assert.equal(restarted.openRound.pages[0].state, "ready");
  assert.equal(restarted.rounds.length, 0);
  const { name, round, title } = data;
  const published = await fetch(`${next.origin}/agent/${a.id}/action`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${a.connection.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "publish",
      sessionId: a.id,
      agent: a.agent,
      html: await buildPage(path.join(a.directory, "source.json"), {
        name,
        round,
        title,
        page: data.pages[1],
      }),
    }),
  });
  assert.equal(published.status, 200, (await published.json()).error);
  assert.equal((await status()).rounds.length, 1);
});
