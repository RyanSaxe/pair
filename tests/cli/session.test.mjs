import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { hub, pairCli } from "../support/hub.mjs";

test("the CLI builds and publishes each page with its own saved source", async (t) => {
  const h = await hub(t);
  const root = path.join(h.home, "cli");
  await fs.mkdir(root);
  // The CLI reads its hub from the state directory, so it gets this test's
  // own, and it runs as the agent that registers the session.
  const cli = await pairCli(root, {
    XDG_STATE_HOME: h.home,
    PAIR_HUB_PORT: "0",
  });
  const registered = await h.session({ cli });
  const session = registered.directory;
  const unsupported = await registered.action("publish", {
    html: '<script type="application/json" id="session-config">{}</script><script type="application/json" id="plan-data">{}</script>',
  });
  assert.equal(unsupported.code, 400);
  assert.match(unsupported.body.error, /page-data/);
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
  assert.equal((await registered.status()).body.rounds.length, 1);
});
