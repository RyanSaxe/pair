import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { hub, planData } from "../support/hub.mjs";

const overview = (html) => ({ id: "overview", title: "Overview", html });
const embed = (h, session, round) =>
  fetch(`${h.server.origin}${session.base}/embed/${round}`);

test("the search window's route serves a published round on today's frame, compressed", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const published = await a.publish({
    ...planData(),
    pages: [overview("<p>The kestrel plan.</p>")],
  });
  assert.equal(published.code, 200, published.body.error);
  const reply = await embed(h, a, "latest");
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("content-encoding"), "gzip");
  const page = await reply.text();
  // The frame fetches each page it shows, so it carries none of them.
  assert.doesNotMatch(page, /The kestrel plan/);
  assert.match(page, /"embedded": true/);
  // It holds what a round's page holds, and no secret of the session.
  assert.doesNotMatch(page, new RegExp(a.connection.token));
});

test("an older round is read-only there, a closed session is closed, and an unknown round is refused", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish({ ...planData(), pages: [overview("<p>One.</p>")] });
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal((await a.action("read")).code, 200);
  await a.publish({ ...planData("2"), pages: [overview("<p>Two.</p>")] });
  const older = await (await embed(h, a, "1")).text();
  assert.match(older, /"readonly": true/);
  const latest = await (await embed(h, a, "latest")).text();
  assert.doesNotMatch(latest, /"readonly": true/);
  assert.equal((await embed(h, a, "9")).status, 404);
  const closed = await fetch(`${h.server.origin}${a.base}/api/dismiss`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: h.server.origin },
    body: "{}",
  });
  assert.equal(closed.status, 200);
  assert.match(await (await embed(h, a, "latest")).text(), /"closed": true/);
});

test("a large JSON reply is compressed, and a small one isn't", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish({ ...planData(), pages: [overview("<p>One.</p>")] });
  const status = () => fetch(`${h.server.origin}${a.base}/api/status`);
  assert.equal((await status()).headers.get("content-encoding"), null);
  const started = await a.request(`${a.base}/api/threads`, {
    id: crypto.randomUUID(),
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "kestrel ".repeat(20000),
  });
  assert.equal(started.code, 201);
  const large = await status();
  assert.equal(large.headers.get("content-encoding"), "gzip");
  assert.match((await large.json()).threads[0].messages[0].text, /kestrel/);
});
