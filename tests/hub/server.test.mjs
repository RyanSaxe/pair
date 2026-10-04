import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { startHub } from "../../src/hub/server.mjs";
import { readPlanData } from "../../src/shared/records.mjs";
import {
  exists,
  hub,
  pairCli,
  planData,
  sessionConfig,
  sleep,
} from "../support/hub.mjs";

test("two sessions on one hub isolate tokens, events, and acknowledgements", async (t) => {
  const h = await hub(t);
  const a = await h.session(),
    b = await h.session();
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.connection.token, b.connection.token);
  assert.equal(a.connection.origin, h.server.origin);
  assert.equal(a.info.url, `${h.server.origin}${a.base}/`);
  assert.equal((await a.publish(planData())).code, 200);
  assert.equal((await b.publish(planData())).code, 200);
  const event = a.event();
  assert.equal((await b.feedback(event)).code, 409);
  assert.equal((await a.feedback(event)).code, 200);
  assert.equal((await b.action("read")).body.event, null);
  assert.equal((await b.action("read", { id: event.id })).code, 404);
  assert.equal((await a.action("read")).body.event.id, event.id);
  assert.deepEqual((await b.status()).body.acknowledged, []);
  assert.equal(
    (await a.feedback(a.event(), { Origin: "http://example.com" })).code,
    403,
  );
  assert.equal(
    (
      await a.action(
        "read",
        {},
        { authorization: `Bearer ${b.connection.token}` },
      )
    ).code,
    403,
  );
  assert.equal((await a.action("read", {}, { authorization: "" })).code, 403);
  const html = (await a.request(`${a.base}/`)).body;
  assert(html.includes(a.id));
  assert(!html.includes(a.connection.token));
  assert(!html.includes(h.record.secret));
  assert.equal((await a.request("/s/unknown/")).code, 404);
  assert.equal(
    (await a.request("/agent/register", { sessionDir: a.directory })).code,
    403,
  );
  const listed = (await a.request("/api/sessions")).body.sessions;
  assert.deepEqual(listed.map((item) => item.id).sort(), [a.id, b.id].sort());
});

test("the hub lists open sessions needs-you first, and a paused one stays listed as paused", async (t) => {
  const h = await hub(t);
  const a = await h.session(),
    b = await h.session();
  // A session with nothing published is listed, and its URL serves its
  // home view.
  const c = await h.session();
  await a.publish(planData());
  await b.publish(planData());
  // a was published first, and only b waits for the reviewer.
  await a.feedback(a.event());
  await a.action("read");
  const listed = async () =>
    (await a.request("/api/sessions")).body.sessions.map((item) => [
      item.id,
      item.needsYou,
      item.paused,
    ]);
  assert.deepEqual(await listed(), [
    [b.id, true, false],
    [a.id, false, false],
    [c.id, false, false],
  ]);
  assert.equal(
    (await a.action("pause", { reason: "asked to stop" })).code,
    200,
  );
  assert.equal((await a.status()).body.paused.reason, "asked to stop");
  assert.deepEqual(await listed(), [
    [b.id, true, false],
    [a.id, false, true],
    [c.id, false, false],
  ]);
  assert.equal((await a.request(`${a.base}/`)).code, 200);
  const home = await c.request(`${c.base}/`);
  assert.equal(home.code, 200);
  assert.deepEqual(sessionConfig(home.body), {
    sessionId: c.id,
    base: c.base,
    home: true,
  });
});

test("the hub lists when each session started, and a new hub keeps it", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const startedAt = async (origin) =>
    (await (await fetch(`${origin}/api/sessions`)).json()).sessions.find(
      (item) => item.id === a.id,
    ).startedAt;
  const first = await startedAt(h.server.origin);
  assert.ok(Date.parse(first));
  await h.server.close();
  const next = await startHub(h.config);
  assert.equal(await startedAt(next.origin), first);
  // A session saved before startedAt existed takes its directory's
  // creation time instead.
  await next.close();
  const file = path.join(a.directory, "status.json");
  const { startedAt: dropped, ...older } = JSON.parse(
    await fs.readFile(file, "utf8"),
  );
  assert.equal(dropped, first);
  await fs.writeFile(file, JSON.stringify(older));
  const last = await startHub(h.config);
  t.after(last.close);
  const filled = await startedAt(last.origin);
  assert.ok(
    Math.abs(Date.parse(filled) - Date.parse(first)) < 60_000,
    `${filled} is not close to ${first}`,
  );
});

test("closing a session from the session list completes it and drops it from the list", async (t) => {
  const h = await hub(t);
  const a = await h.session(),
    b = await h.session();
  await a.publish(planData());
  await b.publish(planData());
  assert.equal(
    (await b.request(`${b.base}/api/dismiss`, {}, { Origin: "http://evil" }))
      .code,
    403,
  );
  const dismissed = await b.request(`${b.base}/api/dismiss`, {});
  assert.equal(dismissed.code, 200);
  assert.equal(dismissed.body.status.stage, "complete");
  const status = (await b.status()).body;
  assert.equal(status.stage, "complete");
  assert.equal(typeof status.dismissedAt, "string");
  const list = (await a.request("/api/sessions")).body.sessions;
  assert.deepEqual(
    list.map((item) => item.id),
    [a.id],
  );
  // The closed session's own page comes back read-only, so a tab still
  // open on it cannot send anything.
  assert.deepEqual(sessionConfig((await b.request(`${b.base}/`)).body), {
    sessionId: b.id,
    base: b.base,
    closed: true,
  });
  assert.deepEqual(sessionConfig((await a.request(`${a.base}/`)).body), {
    sessionId: a.id,
    base: a.base,
  });
});

// A tab opened before the session closed can still send, after ✕ on its
// line in the session list.
test("a closed session refuses feedback and wakes no agent", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  assert.equal((await a.request(`${a.base}/api/dismiss`, {})).code, 200);
  const sent = await a.feedback(a.event());
  assert.equal(sent.code, 409);
  assert.equal(sent.body.error, "This session is closed");
  assert.equal((await a.status()).body.stage, "complete");
  await sleep(50);
  assert.equal(a.inbox.wakes.length, 0);
});

test("the root URL opens the session that most needs you, then the last viewed, else says so", async (t) => {
  const h = await hub(t);
  const open = async (cookie) => {
    const response = await fetch(h.server.origin + "/", {
      redirect: "manual",
      headers: cookie ? { cookie } : {},
    });
    return {
      code: response.status,
      location: response.headers.get("location"),
      text: await response.text(),
    };
  };
  let result = await open();
  assert.equal(result.code, 200);
  assert.match(result.text, /No live sessions/);
  const a = await h.session(),
    b = await h.session();
  await b.publish(planData());
  await sleep(5);
  await a.publish(planData());
  result = await open();
  assert.equal(result.code, 302);
  assert.equal(result.location, `${b.base}/`);
  for (const session of [a, b]) {
    const event = session.event();
    await session.feedback(event);
    await session.action("read");
  }
  assert.equal((await open(`pair-last=${a.id}`)).location, `${a.base}/`);
  assert.equal((await open(`pair-last=nope`)).location, `${b.base}/`);
  const page = await fetch(h.server.origin + `${a.base}/`);
  assert.match(page.headers.get("set-cookie"), new RegExp(`pair-last=${a.id}`));
  const bare = await fetch(h.server.origin + a.base, { redirect: "manual" });
  assert.equal(bare.headers.get("location"), `${a.base}/`);
});

test("round routes inject read-only and preview flags and serve prototypes sandboxed", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const demo = {
    id: "demo",
    title: "Demo",
    html: "<!doctype html><p>demo $&</p>",
    height: 100,
  };
  const data = {
    ...planData(),
    pages: [
      {
        id: "overview",
        title: "Preview",
        html: '<div data-prototype="demo"></div>',
        prototypes: [demo],
      },
    ],
  };
  assert.equal((await a.publish(data)).code, 200);
  await a.feedback(a.event());
  await a.action("read");
  assert.equal((await a.publish(planData("2"))).code, 200);
  const live = (await a.request(`${a.base}/`)).body;
  assert.deepEqual(sessionConfig(live), {
    sessionId: a.id,
    base: a.base,
  });
  assert.equal(readPlanData(live).round, "2");
  const readonly = await a.request(`${a.base}/r/1`);
  assert.equal(readonly.code, 200);
  assert.deepEqual(sessionConfig(readonly.body), {
    sessionId: a.id,
    base: a.base,
    readonly: true,
  });
  assert.equal(readPlanData(readonly.body).round, "1");
  assert.deepEqual(
    sessionConfig((await a.request(`${a.base}/preview/1`)).body),
    {
      sessionId: a.id,
      base: a.base,
      preview: true,
    },
  );
  assert.equal((await a.request(`${a.base}/r/9`)).code, 404);
  const prototype = await a.request(`${a.base}/r/1/prototype/demo`);
  assert.equal(prototype.code, 200);
  assert.equal(prototype.body, demo.html);
  assert.match(prototype.headers.get("content-security-policy"), /sandbox/);
  assert.equal((await a.request(`${a.base}/r/1/prototype/nope`)).code, 404);
  const stored = await fs.readFile(
    path.join(a.directory, "rounds/example.1.html"),
    "utf8",
  );
  assert.deepEqual(sessionConfig(stored), { sessionId: a.id, base: a.base });
  assert.deepEqual(h.record.hosts, ["127.0.0.1"]);
  const forged = await new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: h.record.port,
        path: `${a.base}/api/status`,
        headers: { host: "10.0.0.1:" + h.record.port },
      },
      (response) => resolve(response.statusCode),
    );
    request.once("error", reject);
    request.end();
  });
  assert.equal(forged, 403);
});

test("a round URL with a malformed escape is a bad request", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  for (const route of ["r", "preview"])
    assert.equal((await a.request(`${a.base}/${route}/%E0%A4%A`)).code, 400);
});

test("explicit feedback is retryable, remains unread until read, and blocks premature publication", async (t) => {
  const h = await hub(t);
  const agent = await pairCli(h.home, { PAIR_HUB_PORT: "0" });
  const a = await h.session({ cli: agent });
  await a.publish(planData());
  const event = a.event();
  const receipt = await a.feedback(event);
  assert.equal(receipt.body.status.stage, "submitted");
  assert.deepEqual(receipt.body.status.acknowledged, []);
  assert.equal((await a.feedback(event)).code, 200);
  assert.equal((await a.feedback({ ...event, text: "Changed" })).code, 409);
  assert.equal((await a.publish(planData("2"))).code, 409);
  const cli = async (...args) =>
    JSON.parse(
      await agent.run("read", "--session-dir", a.directory, "--json", ...args),
    );
  const output = await cli();
  assert.deepEqual(output.event.payload, event);
  assert.equal(output.status.stage, "working");
  const acked = (await a.status()).body;
  assert.equal((await cli()).event, null);
  const again = await cli("--submission", event.id);
  assert.deepEqual(again.event.payload, event);
  assert.equal((await a.status()).body.acknowledgedAt, acked.acknowledgedAt);
  assert.equal((await a.action("read", { id: "nope" })).code, 404);
  const original = await fs.readFile(
    path.join(a.directory, "rounds/example.1.html"),
    "utf8",
  );
  assert.equal((await a.publish(planData("2"))).code, 200);
  assert.equal(
    await fs.readFile(path.join(a.directory, "rounds/example.1.html"), "utf8"),
    original,
  );
  assert.equal((await a.feedback(a.event())).code, 409);
  assert.equal((await a.publish(planData("2"))).code, 409);
  const status = JSON.parse(
    await agent.run("status", "--session-dir", a.directory, "--json"),
  );
  assert.equal(status.current.round, "2");
});

test("a session keeps one plan name and uses each round number once", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData("1"));
  await a.feedback(a.event());
  await a.action("read");
  const duplicate = await a.publish(planData("1"));
  assert.equal(duplicate.code, 409);
  assert.match(duplicate.body.error, /Round 1 is already used/);
  const renamed = await a.publish(planData("2", "other"));
  assert.equal(renamed.code, 409);
  assert.equal(
    renamed.body.error,
    "This session's plan is named example. Keep that name in every round.",
  );
  assert.equal(
    await exists(path.join(a.directory, "rounds/other.2.html")),
    false,
  );
  assert.equal((await a.status()).body.current.name, "example");
  assert.equal((await a.publish(planData("2"))).code, 200);
});

test("queued rounds keep receipt order", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const first = a.event(),
    second = a.event();
  await a.feedback(first);
  await a.feedback(second);
  const read = (await a.action("read")).body.event;
  assert.equal(read.id, first.id);
  const next = (await a.action("read")).body.event;
  assert.equal(next.id, second.id);
  assert.equal(next.sequence, read.sequence + 1);
  assert.equal((await a.status()).body.stage, "working");
});

// interactive-plan's sessions keep their own format under their own state
// directory, and pair never reads that format.
test("the hub refuses to open a session interactive-plan created", async (t) => {
  const h = await hub(t);
  const directory = path.join(h.home, "interactive-plan", "sessions", "old");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "status.json"),
    JSON.stringify({
      sessionId: crypto.randomUUID(),
      stage: "ready",
      acknowledged: [],
      current: { artifactId: "plan", revision: "3", kind: "plan" },
    }),
  );
  const response = await fetch(h.server.origin + "/agent/register", {
    method: "POST",
    headers: {
      authorization: `Bearer ${h.record.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionDir: directory,
      wake: { harness: "codex", thread: "t" },
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /is not a pair session/);
  assert.deepEqual(await fs.readdir(directory), ["status.json"]);
});

test("the browser can read sent feedback without agent-only paths", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const feedback = a.event("feedback-only", "1", {
    groups: { choices: {}, notes: [] },
  });
  assert.equal((await a.feedback(feedback)).code, 200);
  const { submission } = (await a.request(`${a.base}/api/submission?round=1`))
    .body;
  assert.equal(submission.id, feedback.id);
  assert.equal(submission.round, "1");
  assert.deepEqual(submission.groups.notes, []);
  assert.deepEqual(submission.groups.choices, {});
  const invalid = await a.request(`${a.base}/api/submission?round=..%2Fsecret`);
  assert.equal(invalid.code, 400);
});

// macOS reaches /tmp/… also as /private/tmp/…, so an agent can name one
// session by two paths.
test("a session reached through a symbolic link is the same session", async (t) => {
  const h = await hub(t);
  const real = path.join(h.home, "real");
  await fs.mkdir(real);
  const link = path.join(h.home, "link");
  await fs.symlink(real, link);
  const box = await h.inbox();
  const first = await h.register(path.join(link, "session"), box.target);
  const { token } = JSON.parse(
    await fs.readFile(path.join(link, "session", "connection.json"), "utf8"),
  );
  const second = await h.register(path.join(real, "session"), box.target);
  assert.equal(second.body.sessionId, first.body.sessionId);
  assert.equal(second.body.sessionDir, first.body.sessionDir);
  const { name, round, title } = planData();
  const agreed = await buildPage(path.join(real, "source.json"), {
    name,
    round,
    title,
    page: {
      id: "agreed",
      title: "Agreed so far",
      agreements: [],
      task: { title: "The task", html: "<p>What the plan builds.</p>" },
    },
  });
  const { sessionId } = first.body;
  const published = await fetch(
    `${h.server.origin}/agent/${sessionId}/action`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "publish",
        sessionId,
        agent: box.agent,
        html: agreed,
        pages: [{ id: "overview", title: "Overview" }],
      }),
    },
  );
  assert.equal(published.status, 200, (await published.json()).error);
});
