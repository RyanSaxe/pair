import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import {
  exists,
  hub,
  killHub,
  pairCli,
  planData,
  task,
} from "../support/hub.mjs";

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
  assert.match(
    unsupported.body.error,
    /--file is not a page that pair build wrote/,
  );
  const command = (args) => cli.run(...args);
  const agreedSource = path.join(root, "agreed-source");
  await fs.mkdir(agreedSource);
  await fs.writeFile(
    path.join(agreedSource, "agreed.json"),
    JSON.stringify({
      name: "cli",
      round: "1",
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
  const noted = JSON.parse(
    await command([
      "progress",
      "--note",
      "Writing the overview page",
      "--session-dir",
      session,
      "--json",
    ]),
  );
  assert.equal(noted.status.report.note, "Writing the overview page");
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
  await assert.rejects(run("read", "--session-dir", missing), (error) => {
    assert.equal(error.code, 1);
    assert.equal(
      error.stderr,
      `pair: No pair session at ${missing}. Check the path, or create a session with pair start.\n`,
    );
    return true;
  });
  assert.equal(await exists(missing), false);
});

// Every command reads its arguments one way, and a refusal names what is
// wrong and the command's help, before anything reaches the hub.
test("a command refuses an unknown flag, an extra argument, a repeated flag and a missing one, and changes nothing", async (t) => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pair-options-"));
  const { config, run, start } = await pairCli(scratch, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const { sessionDir } = await start();
  const dir = ["--session-dir", sessionDir];
  await run("progress", ...dir, "--note", "Reading");
  // Each refusal names the flag or argument that is wrong.
  for (const [args, named] of [
    [["progress", ...dir, "--nte", "x"], "--nte"],
    [["progress", ...dir, "overview"], "overview"],
    [["progress", ...dir, "--note", "a", "--note", "b"], "--note"],
    [["publish", ...dir], "--file"],
    [["status", ...dir, "--page", "overview"], "--page"],
    // pair propose takes no --changes, --reason or --source, which an agent
    // that read an older guide may still pass.
    [
      ["propose", ...dir, "--id", "x", "--changes", "y"],
      "--changes is not a flag of pair propose",
    ],
  ])
    await assert.rejects(run(...args), (error) => {
      assert.equal(error.code, 1);
      assert(error.stderr.includes(named), error.stderr);
      return true;
    });
  const status = () => run("status", ...dir, "--json").then(JSON.parse);
  assert.equal((await status()).report.note, "Reading");
});

// An agent the holder briefs may have no inbox socket of its own, and its
// pair status and pair propose still reach the hub.
test("pair status and pair propose run from an agent that cannot be woken", async (t) => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pair-status-"));
  const { config, start } = await pairCli(scratch, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const { sessionDir } = await start();
  const briefed = path.join(scratch, "briefed");
  await fs.mkdir(briefed);
  const unwakeable = await pairCli(briefed, {
    PAIR_HUB_PORT: "0",
    XDG_STATE_HOME: scratch,
    CLAUDE_CODE_MESSAGING_SOCKET: "",
  });
  const recorded = await unwakeable.run(
    ...["propose", "--session-dir", sessionDir, "--id", "churn-export"],
    ...["--title", "Refresh the churn data export"],
    ...["--delivers", "The export uses the September schema."],
    ...["--recommend", "here"],
  );
  // Only the holder's output starts with the next step.
  assert.equal(recorded, "Proposal churn-export: proposed.\n");
  const status = JSON.parse(
    await unwakeable.run("status", "--session-dir", sessionDir, "--json"),
  );
  assert.equal(status.title, "Test");
  assert.match(
    await unwakeable.run("status", "--session-dir", sessionDir),
    /\n\nProposals\n {2}churn-export {2}proposed {2}Refresh the churn data export\n$/,
  );
});

// publish copies its --source into the session before the hub sees the page,
// so a publish that fails must leave no copy, or the retry is refused.
async function sessionWithAgreed(t) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pair-source-"));
  const { config, run, start } = await pairCli(scratch, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const { sessionDir } = await start();
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
  const status = JSON.parse(
    await run("status", "--session-dir", sessionDir, "--json"),
  );
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
  // Root reads any file, and on Windows a mode cannot keep a file from being
  // read, so the copy would not fail.
  if (process.platform === "win32" || process.getuid?.() === 0) return t.skip();
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

test("pair read --thread prints the thread, and pair reply posts to it", async (t) => {
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
    quote: "one result",
    text: "Why one result per input?",
  });
  assert.equal(started.code, 201, started.body.error);
  const dir = ["--session-dir", session.directory];
  const printed = await cli.run("read", ...dir, "--thread", id);
  // The next step names the command that posts the answer.
  const reply = `pair reply --session-dir ${session.directory} --thread ${id}`;
  assert(printed.split("\n")[0].includes(reply), printed);
  const thread = new RegExp(
    `<pair_thread id="${id}"[^>]*>([^]*?)</pair_thread>`,
  ).exec(printed)?.[1];
  for (const part of ["one result", "Why one result per input?"])
    assert(thread?.includes(part), printed);
  const post = (...args) => cli.run("reply", ...dir, "--thread", id, ...args);
  await post("--text", "So a retry can skip it.");
  const file = path.join(root, "reply.html");
  await fs.writeFile(file, '<pre data-language="text">1 in, 1 out</pre>');
  await post("--file", file);
  // A reply takes its text or its file, and both or neither posts nothing.
  await assert.rejects(post("--text", "x", "--file", file), { code: 1 });
  await assert.rejects(post(), { code: 1 });
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
  const status = JSON.parse(await cli.run("status", ...dir, "--json"));
  assert.equal(status.threads, undefined);
  // The thread and pair read's list name the reply with a thumbs up.
  await session.request(`${session.base}/api/threads/${id}/acknowledge`, {
    message: 1,
    acknowledged: true,
  });
  const agent = (await cli.run("read", ...dir, "--thread", id))
    .match(/<pair_message from="agent"[^>]*>/g)
    .map((opening) => opening.includes(' agreed="yes"'));
  assert.deepEqual(agent, [true, false]);
  assert.match(
    await cli.run("read", ...dir),
    new RegExp(`<pair_thread id="${id}"[^>]* agreed="message 2">`),
  );
  // A thread on an alignment names it.
  const aligned = await session.request(`${session.base}/api/threads`, {
    id: "question-2",
    round: "1",
    topic: "agreed",
    anchor: "One result per input",
    agreementId: "results",
    target: "agreement-results",
    text: "Keep the order too?",
  });
  assert.equal(aligned.code, 201, aligned.body.error);
  assert.match(
    await cli.run("read", ...dir, "--thread", "question-2"),
    /<pair_thread id="question-2" page="agreed" on="One result per input" round="1" agreement="results">/,
  );
});

// Builds Agreed for round 1 with the page list given, as the agent does,
// and returns the arguments that publish it.
async function agreedFiles(directory, pages) {
  const { name, round, title } = planData();
  const file = path.join(directory, "agreed.html");
  const list = path.join(directory, "pages.json");
  await fs.writeFile(
    file,
    await buildPage(path.join(directory, "agreed.json"), {
      name,
      round,
      title,
      page: { id: "agreed", title: "Agreed so far", task, agreements: [] },
    }),
  );
  await fs.writeFile(list, JSON.stringify({ pages }));
  return ["--file", file, "--pages", list];
}

// pair start names a new session, and the hub keeps the name in the field
// every Agreed sets to the plan's title.
test("pair start requires --title for a new session, and the first Agreed replaces it", async (t) => {
  const h = await hub(t);
  const root = path.join(h.home, "cli");
  await fs.mkdir(root);
  const cli = await pairCli(root, {
    XDG_STATE_HOME: h.home,
    PAIR_HUB_PORT: "0",
  });
  const refusesTitle = (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /--title/);
    return true;
  };
  await assert.rejects(cli.run("start"), refusesTitle);
  assert.deepEqual(await fs.readdir(h.config.sessions), []);
  const { sessionDir, title } = await cli.start();
  assert.equal(title, "Test");
  const dir = ["--session-dir", sessionDir];
  const status = async () =>
    JSON.parse(await fs.readFile(path.join(sessionDir, "status.json"), "utf8"));
  assert.equal((await status()).title, "Test");
  await assert.rejects(
    cli.run("start", ...dir, "--title", "Other"),
    refusesTitle,
  );
  assert.equal((await status()).title, "Test");
  const agreed = await agreedFiles(root, [
    { id: "overview", title: "Overview" },
  ]);
  await cli.run("publish", ...dir, ...agreed);
  assert.equal((await status()).title, planData().title);
});

test("pair progress notes the round before Agreed, and each page it names", async (t) => {
  const h = await hub(t);
  const root = path.join(h.home, "cli");
  await fs.mkdir(root);
  const cli = await pairCli(root, {
    XDG_STATE_HOME: h.home,
    PAIR_HUB_PORT: "0",
  });
  const { sessionDir } = await cli.start();
  const dir = ["--session-dir", sessionDir];
  const progress = (...args) => cli.run("progress", ...dir, ...args);
  const state = async () =>
    JSON.parse(await cli.run("status", ...dir, "--json"));
  await progress("--note", "Reading");
  assert.equal((await state()).report.note, "Reading");
  await cli.run(
    "publish",
    ...dir,
    ...(await agreedFiles(root, [
      { id: "overview", title: "Overview" },
      { id: "detail", title: "Detail" },
      { id: "later", title: "Later" },
    ])),
  );
  const pages = async () =>
    Object.fromEntries(
      (await state()).openRound.pages.map((page) => [page.id, page]),
    );
  // One unknown page refuses the report before any page changes.
  await assert.rejects(
    progress("--page", "overview", "--page", "nowhere", "--note", "Writing"),
    /\bnowhere\b/,
  );
  assert.equal((await pages()).overview.state, "queued");
  await progress("--page", "overview", "--page", "detail", "--note", "Writing");
  const noted = await pages();
  for (const id of ["overview", "detail"]) {
    assert.equal(noted[id].state, "active");
    assert.equal(noted[id].note.text, "Writing");
  }
  assert.equal(noted.later.state, "queued");
  await progress("--page", "later");
  assert.equal((await pages()).later.state, "active");
});
