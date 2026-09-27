import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { home, hub, post } from "../support/page-hub.mjs";
import { pairCli } from "../support/pair-cli.mjs";

test("the CLI builds and publishes each page with its own saved source", async () => {
  const root = path.join(home, "cli");
  await fs.mkdir(root);
  const session = path.join(root, "session");
  // The CLI reads its hub from the state directory, so it gets this test's
  // own, and it runs as the agent that registers the session.
  const cli = await pairCli(root, { XDG_STATE_HOME: home, PAIR_HUB_PORT: "0" });
  const registered = await post(
    "/agent/register",
    {
      sessionDir: session,
      wake: { harness: "claude-code", socket: cli.agent.id, token: "test" },
    },
    { authorization: `Bearer ${hub.secret}` },
  );
  const tokenForSession = JSON.parse(
    await fs.readFile(path.join(session, "connection.json"), "utf8"),
  ).token;
  const unsupported = await post(
    `/agent/${registered.body.sessionId}/action`,
    {
      action: "publish",
      sessionId: registered.body.sessionId,
      agent: cli.agent,
      html: '<script type="application/json" id="session-config">{}</script><script type="application/json" id="plan-data">{}</script>',
    },
    { authorization: `Bearer ${tokenForSession}` },
  );
  assert.equal(unsupported.status, 400);
  assert.match(unsupported.body.error, /page-data/);
  const badAgreed = await buildPage(path.join(root, "bad.json"), {
    name: "cli",
    round: "1",
    offer: "plan",
    title: "CLI plan",
    page: {
      id: "agreed",
      title: "Agreed so far",
      task: { title: "The task", html: "<p>What the plan builds.</p>" },
      agreements: [
        {
          id: "unsupported",
          title: "Unsupported claim",
          html: "<p>No saved source.</p>",
          sourceRefs: [
            { kind: "note", submissionId: "missing", noteId: "note" },
          ],
        },
      ],
    },
  });
  const rejected = await post(
    `/agent/${registered.body.sessionId}/action`,
    {
      action: "publish",
      sessionId: registered.body.sessionId,
      agent: cli.agent,
      html: badAgreed,
    },
    { authorization: `Bearer ${tokenForSession}` },
  );
  assert.equal(rejected.status, 400);
  const goodAgreed = await buildPage(path.join(root, "good.json"), {
    name: "cli",
    round: "1",
    offer: "plan",
    title: "CLI plan",
    page: {
      id: "agreed",
      title: "Agreed so far",
      agreements: [],
      task: { title: "The task", html: "<p>What the plan builds.</p>" },
    },
  });
  const outside = await post(
    `/agent/${registered.body.sessionId}/action`,
    {
      action: "publish",
      sessionId: registered.body.sessionId,
      agent: cli.agent,
      html: goodAgreed,
      source: "/elsewhere/source",
    },
    { authorization: `Bearer ${tokenForSession}` },
  );
  assert.equal(outside.status, 400);
  assert.equal(
    (
      await (
        await fetch(`${hub.origin}/s/${registered.body.sessionId}/api/status`)
      ).json()
    ).current,
    null,
  );
  const command = (args) => cli.run(...args);
  const agreedSource = path.join(root, "agreed-source");
  await fs.mkdir(agreedSource);
  await fs.writeFile(
    path.join(agreedSource, "agreed.json"),
    JSON.stringify({
      name: "cli",
      round: "1",
      offer: "plan",
      title: "CLI plan",
      page: {
        id: "agreed",
        title: "Agreed so far",
        agreements: [],
        task: { title: "The task", html: "<p>What the plan builds.</p>" },
      },
    }),
  );
  const agreedHtml = path.join(root, "agreed.html");
  await command(["build", path.join(agreedSource, "agreed.json"), agreedHtml]);
  const list = path.join(root, "pages.json");
  await fs.writeFile(
    list,
    JSON.stringify({ pages: [{ id: "overview", title: "Overview" }] }),
  );
  await command([
    "publish",
    "--session-dir",
    session,
    "--file",
    agreedHtml,
    "--pages",
    list,
    "--source",
    agreedSource,
  ]);
  const acked = JSON.parse(
    await command([
      "ack",
      "--note",
      "Writing the overview page",
      "--session-dir",
      session,
    ]),
  );
  assert.equal(acked.status.report.note, "Writing the overview page");
  const overviewSource = path.join(root, "overview-source");
  await fs.mkdir(overviewSource);
  await fs.writeFile(
    path.join(overviewSource, "overview.json"),
    JSON.stringify({
      name: "cli",
      round: "1",
      offer: "plan",
      title: "CLI plan",
      page: { id: "overview", title: "Overview", file: "overview.html" },
    }),
  );
  await fs.writeFile(
    path.join(overviewSource, "overview.html"),
    "<p>Ready by CLI</p>",
  );
  const overviewHtml = path.join(root, "overview-built.html");
  await command([
    "build",
    path.join(overviewSource, "overview.json"),
    overviewHtml,
  ]);
  await command([
    "publish",
    "--session-dir",
    session,
    "--file",
    overviewHtml,
    "--source",
    overviewSource,
  ]);
  assert.match(
    await fs.readFile(
      path.join(session, "src", "1", "overview", "overview.html"),
      "utf8",
    ),
    /Ready by CLI/,
  );
  assert.equal(
    (
      await (
        await fetch(`${hub.origin}/s/${registered.body.sessionId}/api/status`)
      ).json()
    ).rounds.length,
    1,
  );
});
