import assert from "node:assert/strict";
import os from "node:os";
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

test("a large reply is compressed for a browser on another machine, and not for one on this machine", async (t) => {
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find((item) => item.family === "IPv4" && !item.internal)?.address;
  if (!address && !process.env.CI)
    return t.skip("This machine has no address besides loopback");
  const h = await hub(t, { PAIR_HUB_HOST: address });
  const a = await h.session();
  await a.publish({ ...planData(), pages: [overview("<p>The kestrel.</p>")] });
  const phone = `http://${address}:${h.record.port}`;
  const local = h.server.origin;
  const encoding = async (url, headers) =>
    (await fetch(url, { headers })).headers.get("content-encoding");

  const page = await fetch(`${phone}${a.base}/`);
  assert.equal(page.headers.get("content-encoding"), "gzip");
  assert.match(await page.text(), /The kestrel/);
  const status = await fetch(`${phone}${a.base}/api/status`);
  assert.equal(status.headers.get("content-encoding"), "gzip");
  assert.equal((await status.json()).sessionId, a.connection.sessionId);

  assert.equal(await encoding(`${phone}/api/hub`), null);
  assert.equal(
    await encoding(`${phone}${a.base}/`, { "accept-encoding": "identity" }),
    null,
  );
  assert.equal(await encoding(`${local}${a.base}/`), null);
  assert.equal(await encoding(`${local}${a.base}/api/status`), null);

  // The embed route compresses its own page, and a second gzip would break it.
  const frame = await fetch(`${phone}${a.base}/embed/latest`);
  assert.equal(frame.headers.get("content-encoding"), "gzip");
  assert.match(await frame.text(), /"embedded": true/);
});
