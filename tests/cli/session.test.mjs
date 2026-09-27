import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exists, hub, killHub, pairCli } from "../support/hub.mjs";

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
  const overview = {
    name: "cli",
    round: "1",
    title: "CLI plan",
    page: { id: "overview", title: "Overview", file: "overview.html" },
  };
  const overviewJson = path.join(overviewSource, "overview.json");
  await fs.writeFile(
    path.join(overviewSource, "overview.html"),
    "<p>Ready by CLI</p>",
  );
  const overviewHtml = path.join(root, "overview-built.html");
  // Only Agreed's source names the round's offer.
  await fs.writeFile(
    overviewJson,
    JSON.stringify({ ...overview, offer: "plan" }),
  );
  await assert.rejects(
    command(["build", overviewJson, overviewHtml]),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(
        error.stderr,
        `pair: page "overview" names an offer. Only Agreed's source names the round's offer.\n`,
      );
      return true;
    },
  );
  assert.equal(await exists(overviewHtml), false);
  await fs.writeFile(overviewJson, JSON.stringify(overview));
  await command(["build", overviewJson, overviewHtml]);
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
  // The round takes its offer from Agreed.
  assert.deepEqual(
    (await registered.status()).body.rounds.map((item) => item.offer),
    ["plan"],
  );
});

// A mistyped path would otherwise start a session outside sessions/, which
// no hub loads again.
test("a session command refuses a directory that holds no session", async (t) => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pair-missing-"));
  const { config, run } = await pairCli(scratch, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const missing = path.join(scratch, "no-session");
  await assert.rejects(run("ack", "--session-dir", missing), (error) => {
    assert.equal(error.code, 1);
    assert.equal(
      error.stderr,
      `pair: No pair session at ${missing}. Check the path, or create a session with pair start.\n`,
    );
    return true;
  });
  assert.equal(await exists(missing), false);
});

test("a command refuses an option it does not take and changes nothing", async (t) => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pair-options-"));
  const { config, run } = await pairCli(scratch, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const { sessionDir } = JSON.parse(await run("start"));
  await run("ack", "--session-dir", sessionDir, "--note", "Reading");
  await assert.rejects(
    run("ack", "--session-dir", sessionDir, "--nte", "x"),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(
        error.stderr,
        "pair: --nte is not an option of pair ack, which takes --session-dir, --note\n",
      );
      return true;
    },
  );
  const status = JSON.parse(await run("status", "--session-dir", sessionDir));
  assert.equal(status.report.note, "Reading");
});

// pair side-work names its change before the options, and update names the
// item, so a misplaced word is refused like a misspelt option.
test("pair side-work adds an item from any agent and names it on update", async (t) => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pair-side-work-"));
  const { config, run } = await pairCli(scratch, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const { sessionDir } = JSON.parse(await run("start"));
  const add = ["side-work", "add", "--session-dir", sessionDir];
  const { item } = JSON.parse(
    await run(
      ...add,
      "--title",
      "Delete visual-review",
      "--text",
      "The skill is deprecated but still installed.",
      "--source",
      "From the conversation",
    ),
  );
  assert.equal(item.id, "1");
  assert.equal(item.state, "recorded");
  const refused = async (args, stderr) =>
    assert.rejects(run(...args), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stderr, `pair: ${stderr}\n`);
      return true;
    });
  await refused(
    [...add, "--state", "working"],
    "--state is not an option of pair side-work add, which takes --session-dir, --title, --text, --source",
  );
  await refused(
    ["side-work", "update", "--session-dir", sessionDir, "--state", "working"],
    `pair side-work takes add or update:
  pair side-work add --session-dir PATH --title TEXT --text TEXT --source TEXT
  pair side-work update ID --session-dir PATH --state working|pr|done [--url URL]`,
  );
  // The item reaches the hub by its ID, which refuses to move it before the
  // reviewer starts it.
  await refused(
    ["side-work", "update", "1", "--session-dir", sessionDir, "--state", "pr"],
    "Side work 1 has not been started. It starts when the reviewer presses Start in parallel on Agreed.",
  );
  // An agent the holder briefs may have no inbox socket of its own, and its
  // command still reaches the hub.
  const briefed = path.join(scratch, "briefed");
  await fs.mkdir(briefed);
  const unwakeable = await pairCli(briefed, {
    PAIR_HUB_PORT: "0",
    XDG_STATE_HOME: scratch,
    CLAUDE_CODE_MESSAGING_SOCKET: "",
  });
  const { item: second } = JSON.parse(
    await unwakeable.run(
      ...add,
      "--title",
      "Say why a command fails on an older hub",
      "--text",
      'A hub on older code answers ack with "Unknown agent action".',
      "--source",
      "Found while restarting the hub",
    ),
  );
  assert.equal(second.id, "2");
});

// A side-work item's source is text such as a file name, never a path the
// CLI owns, so a refused add leaves it alone.
test("a refused pair side-work add leaves the path its source names", async (t) => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pair-side-work-"));
  const { config, run } = await pairCli(scratch, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const { sessionDir } = JSON.parse(await run("start"));
  const named = path.join(scratch, "README.md");
  await fs.writeFile(named, "kept\n");
  await assert.rejects(
    run(
      "side-work",
      "add",
      "--session-dir",
      sessionDir,
      "--title",
      "Fix the intro",
      "--source",
      named,
    ),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /takes --text/);
      return true;
    },
  );
  assert.equal(await fs.readFile(named, "utf8"), "kept\n");
});
