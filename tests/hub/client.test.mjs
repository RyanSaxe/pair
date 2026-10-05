import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exists, pairCli } from "../support/hub.mjs";

// The server otherHub starts answers /api/hub with every field of pair's
// reply except app, as the interactive-plan hub and older pair hubs do. It
// records the requests it receives.
async function otherHub(t) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        hub: true,
        version: "other",
        pid: process.pid,
        port: server.address().port,
        startedAt: new Date().toISOString(),
        live: 1,
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { port: server.address().port, requests };
}

test("start refuses another program's hub at once and creates no session, and check calls the port busy", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-other-hub-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const other = await otherHub(t);
  const { config, run, start } = await pairCli(home, {
    PAIR_HUB_PORT: String(other.port),
  });
  const started = Date.now();
  await assert.rejects(start(), ({ stderr }) => {
    assert.match(
      stderr,
      new RegExp(`Another program is using port ${other.port}\\.`),
    );
    return true;
  });
  // start waits up to 15 seconds for a pair hub that is still loading its
  // sessions, and must not wait for this one.
  assert(Date.now() - started < 10_000, "start waited for the other hub");
  assert.equal(await exists(config.sessions), false);
  assert(!other.requests.includes("POST /agent/register"));
  assert.equal(JSON.parse(await run("check", "--json")).hub.state, "busy");
});

// A hub whose code predates app in the reply is still pair's, so a pair
// update does not orphan the hub its live sessions run on.
test("a hub whose reply lacks app is pair's when pair's own record names its pid", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-older-hub-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const older = await otherHub(t);
  const { config, run } = await pairCli(home, {
    PAIR_HUB_PORT: String(older.port),
  });
  await fs.mkdir(config.hubDir, { recursive: true });
  await fs.writeFile(
    config.hubFile,
    JSON.stringify({ pid: process.pid, port: older.port, version: "other" }),
  );
  assert.equal(JSON.parse(await run("check", "--json")).hub.state, "hub");
});
