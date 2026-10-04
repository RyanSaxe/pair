import assert from "node:assert/strict";
import test from "node:test";
import { hub, planData } from "../support/hub.mjs";

// What the hub adds to a round's page as it serves it.

test("every round page holds its first frame until its modules have run", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  for (const route of ["", "r/1", "preview/1"]) {
    const page = (await a.request(`${a.base}/${route}`)).body;
    const head = page.slice(0, page.indexOf("</head>"));
    // A module script runs once the page is parsed, and one with no text
    // never runs, so only a non-empty one releases the frame.
    const gates = [
      ...head.matchAll(/<script\b([^>]*)>([^<]*)<\/script>/g),
    ].filter(
      ([, attributes, text]) =>
        /\btype="module"/.test(attributes) &&
        /\bblocking="render"/.test(attributes) &&
        text.trim(),
    );
    assert.equal(gates.length, 1, `/${route}`);
  }
});

test("a live session's page carries the hub's first answers, and a past round's does not", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const html = await (await fetch(h.server.origin + `${a.base}/`)).text();
  const embedded = html.match(
    /<script type="application\/json" id="first-answers">([\s\S]*?)<\/script>/,
  );
  assert.ok(embedded);
  assert.ok(html.indexOf(embedded[0]) < html.indexOf("</head>"));
  const answers = JSON.parse(embedded[1]);
  const status = await (
    await fetch(h.server.origin + `${a.base}/api/status`)
  ).json();
  assert.equal(answers[`${a.base}/api/status`].sessionId, status.sessionId);
  assert.deepEqual(answers[`${a.base}/api/status`].current, status.current);
  assert.deepEqual(
    answers["/api/sessions"],
    await (await fetch(h.server.origin + "/api/sessions")).json(),
  );
  const pastResponse = await fetch(
    h.server.origin + `${a.base}/r/${status.current.round}`,
  );
  assert.equal(pastResponse.status, 200);
  const past = await pastResponse.text();
  assert.doesNotMatch(past, /id="first-answers"/);
});
