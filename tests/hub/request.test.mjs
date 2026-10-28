import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { hub } from "../support/hub.mjs";

// A published page is hundreds of kilobytes, so its request arrives in many
// chunks, and a chunk can end inside a character of two or more bytes.
test("the hub decodes a character that a request splits between two chunks", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const note = "docs”.";
  const body = Buffer.from(
    JSON.stringify({ action: "ack", sessionId: a.id, agent: a.agent, note }),
  );
  // One byte into the three bytes of ”.
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
    // With no Content-Length, each write is a chunk of its own.
    request.write(body.subarray(0, split));
    request.end(body.subarray(split));
  });
  assert.equal(code, 200);
  assert.equal((await a.status()).body.report.note, note);
});
