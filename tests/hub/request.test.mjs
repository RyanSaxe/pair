import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { hub } from "../support/hub.mjs";

// A published page is hundreds of kilobytes, so its request body arrives in
// many chunks, and a chunk can end inside a multibyte character.
test("the hub decodes a character that a request splits between two chunks", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const note = "docs”.";
  const body = Buffer.from(
    JSON.stringify({ action: "ack", sessionId: a.id, agent: a.agent, note }),
  );
  // split falls one byte into the three-byte UTF-8 encoding of ”.
  const split = body.indexOf("”") + 1;
  const code = await new Promise((resolve, reject) => {
    const request = http.request(
      `${h.server.origin}/agent/${a.id}/action`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${a.connection.token}`,
          "Content-Type": "application/json",
        },
      },
      (response) => resolve(response.statusCode),
    );
    request.once("error", reject);
    // Without Content-Length, Node sends each write as a chunk of its own.
    request.write(body.subarray(0, split));
    request.end(body.subarray(split));
  });
  assert.equal(code, 200);
  assert.equal((await a.status()).body.report.note, note);
});
