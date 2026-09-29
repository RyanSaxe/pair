import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exists, hub, killHub, pairCli, planData } from "../support/hub.mjs";

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
        "pair: --nte is not an option of pair ack, which takes --session-dir, --note, --page\n",
      );
      return true;
    },
  );
  await assert.rejects(
    run("status", "--session-dir", sessionDir, "--page", "overview"),
    (error) => {
      assert.equal(
        error.stderr,
        "pair: --page is not an option of pair status, which takes --session-dir\n",
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
  pair side-work update ID --session-dir PATH --state working|pr|done|moved|planned [--url URL]`,
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

// publish copies its --source into the session before the hub sees the page,
// so a publish that fails must leave no copy, or the retry is refused.
async function sessionWithAgreed(t) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pair-source-"));
  const { config, run } = await pairCli(scratch, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const { sessionDir } = JSON.parse(await run("start"));
  const round = { name: "cli", round: "1", title: "CLI plan" };
  const page = async (id, record, html) => {
    const source = path.join(scratch, `${id}-source`);
    await fs.mkdir(source);
    if (html) await fs.writeFile(path.join(source, `${id}.html`), html);
    await fs.writeFile(
      path.join(source, `${id}.json`),
      JSON.stringify({ ...round, ...record }),
    );
    const built = path.join(scratch, `${id}.html`);
    await run("build", path.join(source, `${id}.json`), built);
    return { source, built };
  };
  const agreed = await page("agreed", {
    offer: "plan",
    page: {
      id: "agreed",
      title: "Agreed so far",
      agreements: [],
      task: { title: "The task", html: "<p>What the plan builds.</p>" },
    },
  });
  const overview = await page(
    "overview",
    { page: { id: "overview", title: "Overview", file: "overview.html" } },
    "<p>Ready by CLI</p>",
  );
  const list = path.join(scratch, "pages.json");
  await fs.writeFile(
    list,
    JSON.stringify({ pages: [{ id: "overview", title: "Overview" }] }),
  );
  const publish = (file, source, ...rest) =>
    run(
      "publish",
      "--session-dir",
      sessionDir,
      "--file",
      file,
      "--source",
      source,
      ...rest,
    );
  return { sessionDir, agreed, overview, list, publish, run };
}

test("a publish whose source cannot be copied can be retried", async (t) => {
  const { sessionDir, agreed, list, publish } = await sessionWithAgreed(t);
  await assert.rejects(
    publish(agreed.built, `${agreed.source}-mistyped`, "--pages", list),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /ENOENT/);
      return true;
    },
  );
  assert.equal(
    await exists(path.join(sessionDir, "src", "1", "agreed")),
    false,
  );
  await publish(agreed.built, agreed.source, "--pages", list);
  assert.equal(
    await exists(path.join(sessionDir, "src", "1", "agreed", "agreed.json")),
    true,
  );
});

test("a publish the hub refuses keeps no copy of its source, and can be retried", async (t) => {
  const { sessionDir, agreed, overview, list, publish } =
    await sessionWithAgreed(t);
  const kept = path.join(sessionDir, "src", "1", "overview");
  await assert.rejects(publish(overview.built, overview.source), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Publish Agreed before other pages/);
    return true;
  });
  assert.equal(await exists(kept), false);
  assert.equal(
    await fs.readFile(path.join(overview.source, "overview.html"), "utf8"),
    "<p>Ready by CLI</p>",
  );
  await publish(agreed.built, agreed.source, "--pages", list);
  await publish(overview.built, overview.source);
  assert.match(
    await fs.readFile(path.join(kept, "overview.html"), "utf8"),
    /Ready by CLI/,
  );
});

// Publishes overview through a proxy that forwards to the hub and then
// answers the CLI with answer(response, hubResponse, hubBody).
async function publishThroughProxy(t, answer) {
  const session = await sessionWithAgreed(t);
  const { sessionDir, agreed, overview, list, publish, run } = session;
  await publish(agreed.built, agreed.source, "--pages", list);
  const connectionFile = path.join(sessionDir, "connection.json");
  const connection = JSON.parse(await fs.readFile(connectionFile, "utf8"));
  const origin = connection.origin;
  const proxy = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const hub = await fetch(origin + request.url, {
      method: request.method,
      headers: {
        authorization: request.headers.authorization,
        "content-type": request.headers["content-type"],
      },
      body,
    });
    answer(response, hub, await hub.text());
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => proxy.close());
  connection.origin = `http://127.0.0.1:${proxy.address().port}`;
  await fs.writeFile(connectionFile, JSON.stringify(connection));
  const failure = await publish(overview.built, overview.source).then(
    () => assert.fail("the publish succeeded"),
    (error) => error,
  );
  // pair status goes to the hub itself.
  await fs.writeFile(connectionFile, JSON.stringify({ ...connection, origin }));
  const status = JSON.parse(await run("status", "--session-dir", sessionDir));
  return {
    failure,
    status,
    kept: path.join(sessionDir, "src", "1", "overview"),
  };
}

// The hub keeps the source of each page it publishes, so the CLI removes its
// copy only when the hub refused the publish.
test("a publish whose answer is lost keeps the source the hub recorded", async (t) => {
  const { failure, status, kept } = await publishThroughProxy(t, (response) =>
    response.socket.destroy(),
  );
  assert.equal(failure.code, 1);
  assert.match(failure.stderr, /The hub may have published this page/);
  assert.equal(status.current.source, kept);
  assert.equal(
    await fs.readFile(path.join(kept, "overview.html"), "utf8"),
    "<p>Ready by CLI</p>",
  );
});

test("a publish whose answer is cut off keeps the source the hub recorded", async (t) => {
  const { failure, status, kept } = await publishThroughProxy(
    t,
    (response, hub, body) => {
      response.writeHead(hub.status, {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      });
      response.write(body.slice(0, 10));
      // The CLI has the headers by then, so the body is what is cut off.
      setTimeout(() => response.socket.destroy(), 200);
    },
  );
  assert.match(failure.stderr, /The hub may have published this page/);
  assert.equal(status.current.source, kept);
  assert.equal(await exists(path.join(kept, "overview.html")), true);
});

test("a publish whose copy fails reports the copy's own error, and can be retried", async (t) => {
  // Root reads any file, so the copy would not fail.
  if (process.getuid?.() === 0) return t.skip();
  const { sessionDir, agreed, list, publish } = await sessionWithAgreed(t);
  const locked = path.join(agreed.source, "a-locked");
  await fs.mkdir(locked);
  await fs.writeFile(path.join(locked, "kept.txt"), "kept");
  await fs.chmod(locked, 0o555);
  const secret = path.join(agreed.source, "z-secret.txt");
  await fs.writeFile(secret, "secret");
  await fs.chmod(secret, 0o000);
  await assert.rejects(
    publish(agreed.built, agreed.source, "--pages", list),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /EACCES.*z-secret\.txt/);
      return true;
    },
  );
  assert.deepEqual(await fs.readdir(path.join(sessionDir, "src", "1")), []);
  await fs.chmod(secret, 0o644);
  await publish(agreed.built, agreed.source, "--pages", list);
  const copy = path.join(sessionDir, "src", "1", "agreed", "a-locked");
  assert.equal(await fs.readFile(path.join(copy, "kept.txt"), "utf8"), "kept");
  // The scratch directory is removed after the test, which needs both
  // read-only directories writable again.
  await fs.chmod(locked, 0o755);
  await fs.chmod(copy, 0o755);
});

test("a kept source keeps its relative links", async (t) => {
  const { sessionDir, agreed, list, publish } = await sessionWithAgreed(t);
  await fs.symlink("agreed.json", path.join(agreed.source, "link.json"));
  await publish(agreed.built, agreed.source, "--pages", list);
  assert.equal(
    await fs.readlink(path.join(sessionDir, "src", "1", "agreed", "link.json")),
    "agreed.json",
  );
});

test("a --source that is a link is kept as the directory it names", async (t) => {
  const { sessionDir, agreed, overview, list, publish } =
    await sessionWithAgreed(t);
  await fs.mkdir(path.join(overview.source, "sub"));
  await fs.writeFile(path.join(overview.source, "sub", "own.txt"), "own");
  const link = `${overview.source}-link`;
  await fs.symlink(overview.source, link);
  // Refused before Agreed, and the directory the link names is left alone.
  await assert.rejects(publish(overview.built, link), /Publish Agreed/);
  assert.equal(
    await fs.readFile(path.join(overview.source, "sub", "own.txt"), "utf8"),
    "own",
  );
  await publish(agreed.built, agreed.source, "--pages", list);
  await publish(overview.built, link);
  const kept = path.join(sessionDir, "src", "1", "overview");
  assert.equal((await fs.lstat(kept)).isDirectory(), true);
  assert.equal(
    await fs.readFile(path.join(kept, "sub", "own.txt"), "utf8"),
    "own",
  );
});

test("a kept source's link out of the source keeps its target", async (t) => {
  const { sessionDir, agreed, list, publish } = await sessionWithAgreed(t);
  const shared = path.join(path.dirname(agreed.source), "shared.txt");
  await fs.writeFile(shared, "shared");
  await fs.symlink("../shared.txt", path.join(agreed.source, "shared.txt"));
  await publish(agreed.built, agreed.source, "--pages", list);
  assert.equal(
    await fs.readFile(
      path.join(sessionDir, "src", "1", "agreed", "shared.txt"),
      "utf8",
    ),
    "shared",
  );
});

test("a read-only --source is kept like any other", async (t) => {
  const { sessionDir, agreed, list, publish } = await sessionWithAgreed(t);
  await fs.chmod(agreed.source, 0o555);
  await publish(agreed.built, agreed.source, "--pages", list).finally(() =>
    fs.chmod(agreed.source, 0o755),
  );
  assert.equal(
    await exists(path.join(sessionDir, "src", "1", "agreed", "agreed.json")),
    true,
  );
});

test("an empty kept source says a publish may still be copying or was stopped", async (t) => {
  const { sessionDir, agreed, list, publish } = await sessionWithAgreed(t);
  await fs.mkdir(path.join(sessionDir, "src", "1", "agreed"), {
    recursive: true,
  });
  await assert.rejects(
    publish(agreed.built, agreed.source, "--pages", list),
    (error) => {
      assert.match(
        error.stderr,
        /It is empty, so another publish of this page is still copying, or one was stopped/,
      );
      return true;
    },
  );
});

test("a kept source's link to a name starting with two dots stays inside", async (t) => {
  const { sessionDir, agreed, list, publish } = await sessionWithAgreed(t);
  await fs.writeFile(path.join(agreed.source, "..notes.txt"), "notes");
  await fs.symlink("..notes.txt", path.join(agreed.source, "notes-link"));
  await publish(agreed.built, agreed.source, "--pages", list);
  assert.equal(
    await fs.readlink(
      path.join(sessionDir, "src", "1", "agreed", "notes-link"),
    ),
    "..notes.txt",
  );
});

test("a --source that is empty or a file is refused and leaves nothing", async (t) => {
  const { sessionDir, agreed, list, publish } = await sessionWithAgreed(t);
  const empty = `${agreed.source}-empty`;
  await fs.mkdir(empty);
  await assert.rejects(
    publish(agreed.built, empty, "--pages", list),
    (error) => {
      assert.match(error.stderr, /--source .* is empty/);
      return true;
    },
  );
  const file = path.join(agreed.source, "agreed.json");
  await assert.rejects(
    publish(agreed.built, file, "--pages", list),
    (error) => {
      assert.match(error.stderr, /--source must be a directory/);
      return true;
    },
  );
  assert.equal(await exists(path.join(sessionDir, "src", "1")), false);
});

test("a read-only directory with a link inside the source is kept", async (t) => {
  const { sessionDir, agreed, list, publish } = await sessionWithAgreed(t);
  await fs.writeFile(path.join(agreed.source, "notes.md"), "notes");
  await fs.symlink("notes.md", path.join(agreed.source, "latest.md"));
  await fs.chmod(agreed.source, 0o555);
  await publish(agreed.built, agreed.source, "--pages", list).finally(() =>
    fs.chmod(agreed.source, 0o755),
  );
  const kept = path.join(sessionDir, "src", "1", "agreed");
  assert.equal(await fs.readlink(path.join(kept, "latest.md")), "notes.md");
});

test("pair reply prints a thread and posts a reply, and pair status leaves threads out", async (t) => {
  const h = await hub(t);
  const root = path.join(h.home, "cli");
  await fs.mkdir(root);
  const cli = await pairCli(root, {
    XDG_STATE_HOME: h.home,
    PAIR_HUB_PORT: "0",
  });
  const session = await h.session({ cli });
  assert.equal((await session.publish(planData())).code, 200);
  const id = "question-1";
  const started = await session.request(`${session.base}/api/threads`, {
    id,
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "Why one result per input?",
  });
  assert.equal(started.code, 201, started.body.error);
  const reply = (...args) =>
    cli.run("reply", "--session-dir", session.directory, "--note", id, ...args);
  const printed = await reply();
  assert.match(
    printed,
    new RegExp(
      `^Thread ${id} on "Overview" \\(session ${session.directory}, round 1\\)\n  You, \\d\\d:\\d\\d: Why one result per input\\?\n\n`,
    ),
  );
  assert.match(await reply("--text", "So a retry can skip it."), /^Posted/);
  const file = path.join(root, "reply.html");
  await fs.writeFile(file, '<pre data-language="text">1 in, 1 out</pre>');
  assert.match(await reply("--file", file), /^Posted/);
  await assert.rejects(reply("--text", "x", "--file", file), (error) => {
    assert.equal(
      error.stderr,
      "pair: reply takes --text or --file, not both\n",
    );
    return true;
  });
  const { threads } = (await session.status()).body;
  assert.deepEqual(threads[0].messages.slice(1), [
    {
      from: "agent",
      at: threads[0].messages[1].at,
      text: "So a retry can skip it.",
    },
    {
      from: "agent",
      at: threads[0].messages[2].at,
      html: '<pre data-language="text">1 in, 1 out</pre>',
    },
  ]);
  const status = JSON.parse(
    await cli.run("status", "--session-dir", session.directory),
  );
  assert.equal(status.threads, undefined);
});
