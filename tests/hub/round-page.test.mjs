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
