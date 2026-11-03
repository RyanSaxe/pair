import assert from "node:assert/strict";
import test from "node:test";
import { hub, planData } from "../support/hub.mjs";

test("an unchanged status or session list answers 304, and a change answers with the new body", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const polled = [`${a.base}/api/status`, "/api/sessions"].map(
    (route) => h.server.origin + route,
  );
  const tags = [];
  for (const url of polled) {
    const first = await fetch(url);
    assert.equal(first.status, 200);
    const tag = first.headers.get("etag");
    tags.push(tag);
    const unchanged = await fetch(url, { headers: { "if-none-match": tag } });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), "");
  }
  const started = await a.request(`${a.base}/api/threads`, {
    id: "kestrel",
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "What happens to a failed item?",
  });
  assert.equal(started.code, 201, started.body.error);
  for (const [index, url] of polled.entries()) {
    const changed = await fetch(url, {
      headers: { "if-none-match": tags[index] },
    });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get("etag"), tags[index]);
    assert.match(await changed.text(), /kestrel|failed item/);
  }
});
