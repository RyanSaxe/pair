import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../../src/cli/build.mjs";
import {
  alive,
  hub,
  killHub,
  planData,
  sleep,
  waitUntil,
} from "../../support/hub.mjs";
import { pairCli } from "../../support/pair-cli.mjs";

test("start hands the session to its agent, and only the holder works on it and is woken", async (t) => {
  const h = await hub(t);
  const a = await h.session("first");
  await a.publish(planData());
  const register = (thread, start) =>
    a.request(
      "/agent/register",
      {
        sessionDir: a.directory,
        wake: { harness: "codex", thread },
        ...(start ? { start } : {}),
      },
      { authorization: `Bearer ${h.record.secret}` },
    );
  const clock = (iso) =>
    [new Date(iso).getHours(), new Date(iso).getMinutes()]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  // The holder running start again, after an interrupted turn, keeps it.
  const first = (await a.status()).body.holder;
  assert.equal((await register("thread-first", true)).code, 200);
  assert.deepEqual((await a.status()).body.holder, first);
  // An agent that never held it hears who has held it since when, and how
  // to take it over, not that anyone took it over.
  const third = { harness: "codex", id: "thread-third" };
  assert.equal(
    (await a.action("status", { agent: third })).body.error,
    `Another agent has held this session since ${clock(first.at)}. Stop working on it unless the user asks you to take it over with: pair start --session-dir ${a.directory}`,
  );
  // Another agent's start takes it over, and the reviewer's card says so.
  await sleep(5);
  assert.equal((await register("thread-second", true)).code, 200);
  const { holder, takeover } = (await a.status()).body;
  assert.equal(holder.harness, "codex");
  assert.notEqual(holder.at, first.at);
  assert.deepEqual(takeover, { name: "Codex", at: holder.at });
  // The first agent's next command, start included, is refused with the time
  // it lost the session, so it stops instead of taking the session back.
  const lost = await register("thread-first", true);
  assert.equal(lost.code, 409);
  assert.equal(
    lost.body.error,
    `Another agent took this session over at ${clock(holder.at)}. Stop working on it.`,
  );
  // After that it is refused as any agent that does not hold the session.
  for (const refused of [
    await a.action("ack"),
    await a.action("publish", { html: "" }),
    await register("thread-first", false),
  ]) {
    assert.equal(refused.code, 409);
    assert.match(refused.body.error, /^Another agent has held this session/);
  }
  assert.deepEqual((await a.status()).body.holder, holder);
  const second = { harness: "codex", id: "thread-second" };
  assert.equal((await a.action("ack", { agent: second })).code, 200);
  // Only the holder is woken, and the card's takeover line lasts until the
  // reviewer sends again.
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal(await waitUntil(() => h.wakes.length === 1), true);
  assert.deepEqual(h.wakes, [{ harness: "codex", thread: "thread-second" }]);
  assert.equal((await a.status()).body.takeover, null);
  // The handoff line hands the session back to the first agent.
  assert.equal((await register("thread-first", true)).code, 200);
  assert.equal((await a.action("read")).code, 200);
  assert.equal((await a.action("ack", { agent: second })).code, 409);
});

test("a saved plan outlives its hub until another agent takes it over", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-handoff-"));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const env = {
    XDG_STATE_HOME: home,
    PAIR_HUB_PORT: String(port),
    PAIR_HUB_IDLE_SECONDS: "1",
  };
  const agent = async (name) => {
    await fs.mkdir(path.join(home, name));
    return pairCli(path.join(home, name), env);
  };
  const one = await agent("one");
  const two = await agent("two");
  t.after(async () => {
    await killHub(one.config);
    await fs.rm(home, { recursive: true, force: true });
  });
  const saved = JSON.parse(await one.run("start"));
  const run = (cli, ...args) =>
    cli.run(...args, "--session-dir", saved.sessionDir);
  const plan = { name: "example", round: "1", offer: "plan", title: "Plan" };
  const files = {
    agreed: {
      id: "agreed",
      title: "Agreed so far",
      agreements: [],
      task: { title: "The task", html: "<p>What the plan builds.</p>" },
    },
    overview: { id: "overview", title: "Overview", html: "<p>Build it.</p>" },
  };
  for (const [id, page] of Object.entries(files))
    await fs.writeFile(
      path.join(home, `${id}.html`),
      await buildPage(path.join(home, "source.json"), { ...plan, page }),
    );
  await fs.writeFile(
    path.join(home, "pages.json"),
    JSON.stringify({ pages: [{ id: "overview", title: "Overview" }] }),
  );
  await run(
    one,
    "publish",
    "--file",
    path.join(home, "agreed.html"),
    "--pages",
    path.join(home, "pages.json"),
  );
  await run(one, "publish", "--file", path.join(home, "overview.html"));
  const hubRecord = JSON.parse(await fs.readFile(one.config.hubFile, "utf8"));
  const origin = `http://127.0.0.1:${port}`;
  const accepted = await fetch(`${origin}/s/${saved.sessionId}/api/feedback`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...plan,
      sessionId: saved.sessionId,
      id: crypto.randomUUID(),
      intent: "accept",
      action: "save",
      groups: {},
      text: "Save it",
    }),
  });
  assert.equal(accepted.status, 200);
  // A saved session is not live, so the hub exits with only it left.
  assert.equal(await waitUntil(() => !alive(hubRecord.pid), 5000), true);
  // A new hub loads it from disk at the URL it had.
  const fresh = JSON.parse(await two.run("start"));
  const listed = await fetch(`${origin}/api/sessions`).then((response) =>
    response.json(),
  );
  assert.deepEqual(
    listed.sessions.map(({ url, stage }) => [url, stage]),
    [[`/s/${saved.sessionId}/`, "saved"]],
  );
  assert.equal(fresh.url, `${origin}/s/${fresh.sessionId}/`);
  // Another agent takes it over with the handoff line and is sent to build it.
  const handoff = JSON.parse(await run(one, "status")).handoff;
  assert.equal(
    handoff,
    `Take over pair session ${saved.sessionDir}: run pair start --session-dir ${saved.sessionDir} and follow what it prints.`,
  );
  const took = JSON.parse(await run(two, "start"));
  assert.equal(took.url, saved.url);
  assert.match(
    took.next,
    new RegExp(
      `^Round 1 was saved for later, and you now build it\\. Read \\S+/guide/offers/plan\\.md, then run: pair read --session-dir ${saved.sessionDir}\\. .* its action stays save\\. Build the plan as the implement action describes\\.$`,
    ),
  );
  const status = JSON.parse(await run(two, "status"));
  assert.equal(status.stage, "working");
  assert.equal(status.latestSubmissionRound, "1");
  await assert.rejects(
    run(one, "ack"),
    /Another agent took this session over at \d\d:\d\d\. Stop working on it\./,
  );
});
