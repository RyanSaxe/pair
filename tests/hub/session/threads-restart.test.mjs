import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../../src/cli/build.mjs";
import { startHub } from "../../../src/hub/server.mjs";
import {
  alive,
  killHub,
  pairCli,
  task,
  waitUntil,
} from "../../support/hub.mjs";

// A hub stops without waiting for the wakes it scheduled, as when a command on
// newer code replaces it. The stub stands in for a slow agent CLI: it keeps the
// first wake's connection open, so the hub stops during that wake, and it
// answers every later wake at once. On Windows, where the stub would listen
// on a named pipe, the hub's wake can finish while the stub holds the pipe
// open, so the thread can be sent before the hub stops.
test(
  "the next hub sends the wake of a thread that a stopped hub left sending",
  {
    skip:
      process.platform === "win32" &&
      "the stub cannot keep a wake in progress on a Windows named pipe",
  },
  async (t) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-owed-"));
    const socket = path.join(home, "agent.sock");
    const wakes = [];
    const stub = net.createServer({ allowHalfOpen: true }, (client) => {
      let text = "";
      client.on("error", () => {});
      client.on("data", (chunk) => (text += chunk));
      client.on("end", () => {
        wakes.push(JSON.parse(text.trim().split("\n")[1]).message.content);
        if (wakes.length > 1) client.end();
      });
    });
    await new Promise((resolve) => stub.listen(socket, resolve));
    stub.unref();
    const { config, run, start } = await pairCli(home, {
      PAIR_HUB_PORT: "0",
      PAIR_HUB_HOST: "",
      CLAUDE_CODE_MESSAGING_SOCKET: socket,
      CLAUDE_CODE_MESSAGING_TOKEN: "test",
    });
    t.after(async () => {
      await killHub(config);
      stub.close();
      await fs.rm(home, { recursive: true, force: true });
    });
    const { sessionId, sessionDir } = await start();
    const source = path.join(home, "source.json");
    const publish = async (page, ...args) => {
      const file = path.join(home, `${page.id}.html`);
      await fs.writeFile(
        file,
        await buildPage(source, {
          name: "owed",
          round: "1",
          title: "Owed",
          page,
        }),
      );
      await run(
        "publish",
        "--file",
        file,
        ...args,
        "--session-dir",
        sessionDir,
      );
    };
    const pages = path.join(home, "pages.json");
    await fs.writeFile(
      pages,
      JSON.stringify({ pages: [{ id: "overview", title: "Overview" }] }),
    );
    await publish(
      { id: "agreed", title: "Agreed so far", agreements: [], task },
      "--pages",
      pages,
    );
    await publish({ id: "overview", title: "Overview", html: "<p>One</p>" });
    const post = (origin, route, data) =>
      fetch(`${origin}/s/${sessionId}/api/threads${route}`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    const first = JSON.parse(await fs.readFile(config.hubFile, "utf8"));
    const origin = `http://127.0.0.1:${first.port}`;
    const id = crypto.randomUUID();
    const thread = { id, round: "1", topic: "overview", anchor: "One" };
    const opened = await post(origin, "", { ...thread, text: "First message" });
    assert.equal(opened.status, 201);
    assert.equal(await waitUntil(() => wakes.length === 1), true);
    const saved = JSON.parse(
      await fs.readFile(path.join(sessionDir, "threads", `${id}.json`), "utf8"),
    );
    assert.equal(saved.state, "sending");
    process.kill(first.pid, "SIGTERM");
    assert.equal(await waitUntil(() => !alive(first.pid)), true);
    const next = await startHub({ ...config, log() {} });
    t.after(() => next.close());
    assert.equal(await waitUntil(() => wakes.length === 2), true);
    assert.equal(wakes[1], wakes[0]);
    const state = async () =>
      (
        await (await fetch(`${next.origin}/s/${sessionId}/api/status`)).json()
      ).threads.find((item) => item.id === id).state;
    assert.equal(await waitUntil(async () => (await state()) === "sent"), true);
    const added = await post(next.origin, `/${id}/messages`, {
      text: "Second message",
    });
    assert.equal(added.status, 201);
    assert.equal(await waitUntil(() => wakes.length === 3), true);
    assert.match(wakes[2], /Second message$/);
  },
);
