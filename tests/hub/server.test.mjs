import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { readPlanData } from "../../src/shared/records.mjs";
import {
  exists,
  hub,
  planData,
  sessionConfig,
  sleep,
} from "../support/hub.mjs";
import { pairCli } from "../support/pair-cli.mjs";
import { sessionId, hub as wakeHub } from "../support/wake-hub.mjs";

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
  await h.session();
  await a.publish(planData());
  await sleep(5);
  await b.publish(planData());
  let list = (await a.request("/api/sessions")).body.sessions;
  assert.deepEqual(
    list.map((item) => item.id),
    [a.id, b.id],
  );
  const feedback = b.event();
  await b.feedback(feedback);
  await b.action("read");
  list = (await a.request("/api/sessions")).body.sessions;
  assert.deepEqual(
    list.map((item) => [item.id, item.needsYou, item.stage]),
    [
      [a.id, true, "updated"],
      [b.id, false, "working"],
    ],
  );
  await b.publish(planData("2"));
  const first = a.event();
  await a.feedback(first);
  await a.action("read");
  list = (await a.request("/api/sessions")).body.sessions;
  assert.deepEqual(
    list.map((item) => item.id),
    [b.id, a.id],
  );
  assert.equal(list[0].round, "2");
  assert.equal(
    (await b.action("pause", { reason: "asked to stop" })).code,
    200,
  );
  assert.equal((await b.status()).body.paused.reason, "asked to stop");
  list = (await a.request("/api/sessions")).body.sessions;
  assert.deepEqual(
    list.map((item) => [item.id, item.paused]),
    [
      [b.id, true],
      [a.id, false],
    ],
  );
  assert.equal((await b.request(`${b.base}/`)).code, 200);
  const again = await fetch(h.server.origin + "/agent/register", {
    method: "POST",
    headers: {
      authorization: `Bearer ${h.record.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionDir: b.directory,
      wake: { harness: "codex", thread: "thread-again" },
      start: true,
    }),
  });
  assert.equal(again.status, 200);
  assert.equal((await b.status()).body.paused, null);
});

test("closing a session from the bell panel completes it and drops it from the list", async (t) => {
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

test("explicit feedback is retryable, remains unread until read, and blocks premature publication", async (t) => {
  const h = await hub(t);
  const agent = await pairCli(h.home, { PAIR_HUB_PORT: "0" });
  const a = await h.session(undefined, agent);
  await a.publish(planData());
  const event = a.event();
  const receipt = await a.feedback(event);
  assert.equal(receipt.body.status.stage, "submitted");
  assert.deepEqual(receipt.body.status.acknowledged, []);
  assert.equal((await a.feedback(event)).code, 200);
  assert.equal((await a.feedback({ ...event, text: "Changed" })).code, 409);
  assert.equal((await a.publish(planData("2"))).code, 409);
  const cli = async (...args) =>
    JSON.parse(await agent.run("read", "--session-dir", a.directory, ...args));
  const output = await cli();
  assert.deepEqual(output.event.payload, event);
  assert.equal(output.status.stage, "working");
  const acked = (await a.status()).body;
  assert.equal((await cli()).event, null);
  const again = await cli("--id", event.id);
  assert.deepEqual(again.event.payload, event);
  assert.equal((await a.status()).body.acknowledgedAt, acked.acknowledgedAt);
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
    await agent.run("status", "--session-dir", a.directory),
  );
  assert.equal(status.current.round, "2");
});

test("a session rejects a round number reused under another name", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData("1"));
  await a.feedback(a.event());
  await a.action("read");
  const duplicate = await a.publish(planData("1", undefined, "other"));
  assert.equal(duplicate.code, 409);
  assert.match(duplicate.body.error, /Round 1 is already used/);
  assert.equal(
    await exists(path.join(a.directory, "rounds/other.1.html")),
    false,
  );
  assert.equal((await a.status()).body.current.name, "example");
  const next = await a.publish(planData("2", undefined, "other"));
  assert.equal(next.code, 200, next.body.error);
  assert.equal((await a.status()).body.current.name, "other");
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

test("the browser can read sent feedback without agent-only paths", async () => {
  const submission = await (
    await fetch(`${wakeHub.origin}/s/${sessionId}/api/submission?round=1`)
  ).json();
  assert.equal(submission.submission.id, "evt1");
  assert.equal(submission.submission.round, "1");
  assert.deepEqual(submission.submission.groups.notes, []);
  assert.deepEqual(submission.submission.groups.choices, {});
  const invalid = await fetch(
    `${wakeHub.origin}/s/${sessionId}/api/submission?round=..%2Fsecret`,
  );
  assert.equal(invalid.status, 400);
});
