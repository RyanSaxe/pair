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
  literal,
  pairCli,
  planData,
  task,
} from "../support/hub.mjs";

// Without this check, a mistyped path would start a session outside sessions/,
// and no hub would load that session again. The hub creates a session in any
// directory it registers, so pair start --session-dir refuses a directory with
// no session before it sends a request to the hub.
test("a session command refuses a directory that holds no session and writes nothing", async (t) => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pair-missing-"));
  const { config, run } = await pairCli(scratch, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const missing = path.join(scratch, "no-session");
  const project = path.join(scratch, "project");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "README"), "hi");
  const create =
    'run pair start --title "…" without --session-dir to create a new session';
  for (const [command, directory, what] of [
    ["read", missing, "create a session with pair start"],
    ["start", missing, create],
    ["start", project, create],
  ]) {
    const before = await fs.readdir(scratch, { recursive: true });
    await assert.rejects(run(command, "--session-dir", directory), (error) => {
      assert.equal(error.code, 1);
      assert.equal(
        error.stderr,
        `pair: No pair session at ${directory}. Check the path, or ${what}.\n`,
      );
      return true;
    });
    assert.deepEqual(await fs.readdir(scratch, { recursive: true }), before);
  }
});

// Every command parses its arguments the same way. On a bad argument, the
// command prints what is wrong and its help, and exits before it sends anything
// to the hub.
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
  for (const [args, named] of [
    [["progress", ...dir, "--nte", "x"], "--nte"],
    [["progress", ...dir, "overview"], "overview"],
    [["progress", ...dir, "--note", "a", "--note", "b"], "--note"],
    [["publish", ...dir], "--file"],
    [["status", ...dir, "--page", "overview"], "--page"],
    // An agent that read an older guide may still pass --changes, --reason or
    // --source to pair propose, which takes none of them.
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

// A subagent that the holder briefs may have no inbox socket of its own. Its
// pair status and pair propose must still reach the hub.
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
  // pair prints the next step only to the holder, so this output starts with
  // the proposal.
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

// pair publish copies its --source into the session before it sends the page to
// the hub. A publish that fails must remove that copy, or pair publish refuses
// the retry.
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
  // publish starts overview with Agreed's page list, as the agent does.
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
      ...(rest.includes("--pages") ? ["--start", "overview"] : []),
    );
  return { sessionDir, agreed, overview, list, page, publish, run };
}

// A link to the sessions directory stands in for /var and /private/var on
// macOS, two paths to one directory.
test("a publish keeps its source when --session-dir reaches the session by another path", async (t) => {
  const { sessionDir, agreed, list, run } = await sessionWithAgreed(t);
  const parent = path.dirname(sessionDir);
  const link = `${parent}-link`;
  await fs.symlink(parent, link);
  const other = path.join(link, path.basename(sessionDir));
  await run(
    "publish",
    "--session-dir",
    other,
    "--file",
    agreed.built,
    "--source",
    agreed.source,
    "--pages",
    list,
    "--start",
    "overview",
  );
  assert.equal(
    await exists(path.join(sessionDir, "src", "1", "agreed", "agreed.json")),
    true,
  );
});

// A file that holds a whole round, as the fixture build writes, has the frame's
// session config but no page record, and the hub publishes only a page that
// pair build wrote.
test("the hub refuses a file pair build did not write, and a kept source outside the session directory", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const assembled = await a.action("publish", {
    html: '<script type="application/json" id="session-config">{}</script><script type="application/json" id="plan-data">{}</script>',
  });
  assert.equal(assembled.code, 400);
  assert.match(
    assembled.body.error,
    /--file is not a page that pair build wrote/,
  );
  const html = await buildPage(path.join(a.directory, "source.json"), {
    name: "example",
    round: "1",
    title: "Example work",
    page: { id: "agreed", title: "Agreed so far", task, agreements: [] },
  });
  const beside = `${a.directory}-beside`;
  const linked = path.join(a.directory, "src", "linked");
  await fs.mkdir(path.dirname(linked), { recursive: true });
  await fs.mkdir(beside);
  await fs.symlink(beside, linked);
  for (const source of [beside, linked, path.join(a.directory, "src", "no")]) {
    const refused = await a.action("publish", { html, source });
    assert.equal(refused.code, 400, source);
    assert.equal(
      refused.body.error,
      "Source must be a directory inside the session directory",
    );
  }
});

// pair build refuses a page this big, so the padding stands in for a file that
// an older pair build wrote or a page list that takes the request over the limit.
test("a publish over the hub's limit is refused with the limit and what to do, and keeps no source", async (t) => {
  const { sessionDir, agreed, overview, list, publish } =
    await sessionWithAgreed(t);
  await publish(agreed.built, agreed.source, "--pages", list);
  const big = path.join(path.dirname(overview.built), "big.html");
  await fs.writeFile(
    big,
    (await fs.readFile(overview.built, "utf8")).replace(
      "</body>",
      () => `<!--${"A".repeat(20_000_000)}--></body>`,
    ),
  );
  await assert.rejects(publish(big, overview.source), (error) => {
    assert.equal(error.code, 1);
    assert.match(
      error.stderr,
      new RegExp(
        `^pair: ${literal(big)} is too big to publish\\. The publish would send the hub \\d+(\\.\\d)? MB, and the hub accepts at most 20 MB\\. pair build writes a page's content into the built file twice, so the images embedded in one page can total about 6\\.7 MB\\. Crop or resize the images, or save them as JPEG or WebP\\. Then build the page again and publish the new file\\.\\n$`,
      ),
    );
    return true;
  });
  assert.equal(
    await exists(path.join(sessionDir, "src", "1", "overview")),
    false,
  );
});

test("a page with images of the size the refusal names builds and publishes", async (t) => {
  const { sessionDir, agreed, list, page, publish } =
    await sessionWithAgreed(t);
  await publish(agreed.built, agreed.source, "--pages", list);
  const fits = await page(
    "fits",
    { page: { id: "overview", title: "Overview", file: "fits.html" } },
    `<img alt="" src="data:image/png;base64,${"A".repeat((6_700_000 / 3) * 4)}">`,
  );
  await publish(fits.built, fits.source);
  assert.equal(
    await exists(path.join(sessionDir, "src", "1", "overview", "fits.html")),
    true,
  );
});

test("a publish with a missing --file names pair build and keeps no source", async (t) => {
  const { sessionDir, agreed, list, publish } = await sessionWithAgreed(t);
  const missing = path.join(path.dirname(agreed.built), "3agreed.html");
  await assert.rejects(
    publish(missing, agreed.source, "--pages", list),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(
        error.stderr,
        `pair: No built page at ${missing}. Build it with pair build SOURCE OUTPUT, or check the path.\n`,
      );
      return true;
    },
  );
  assert.equal(await exists(path.join(sessionDir, "src")), false);
});

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
    assert.equal(
      error.stderr,
      `pair: Publish Agreed with this round's page list before any other page: pair publish --file OUT/agreed.html --pages SRC/pages.json --source SRC/agreed --start ID --session-dir ${sessionDir}.\n`,
    );
    return true;
  });
  assert.equal(await exists(kept), false);
  await assert.rejects(publish(agreed.built, agreed.source), (error) => {
    assert.match(
      error.stderr,
      /^pair: Publish Agreed with --pages SRC\/pages\.json, a file that lists the pages after Agreed as \{ "pages": \[\{ "id": "…", "title": "…" \}\] \}\.$/m,
    );
    return true;
  });
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

// publishThroughProxy publishes overview through a proxy that forwards the
// request to the hub, then calls answer(response, hubResponse, hubBody) to
// answer the CLI.
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
  // Restoring the hub's origin in connection.json sends pair status to the hub
  // directly, not through the proxy.
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
// copy only when the hub refuses the publish.
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
      // The callback runs once the headers and the first bytes of the body
      // are on the socket, so destroying it cuts off only the body.
      response.write(body.slice(0, 10), () => response.socket.destroy());
    },
  );
  assert.match(failure.stderr, /The hub may have published this page/);
  assert.equal(status.current.source, kept);
  assert.equal(await exists(path.join(kept, "overview.html")), true);
});

test("a publish whose copy fails reports the copy's own error, and can be retried", async (t) => {
  // Root can read any file, and on Windows a file mode does not stop a read, so
  // the copy would not fail there.
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
  // The test's cleanup removes the scratch directory, and rm needs both
  // read-only directories to be writable.
  await fs.chmod(locked, 0o755);
  await fs.chmod(copy, 0o755);
});

// fs.cp points each copied link at an absolute path, which dangles once the
// source's temp directory is gone. A read-only source directory is copied
// read-only, and macOS cannot rename a read-only directory.
test("a kept source keeps each link inside it relative and the target of a link out of it, also from a read-only directory", async (t) => {
  const { sessionDir, agreed, list, publish } = await sessionWithAgreed(t);
  const shared = path.join(path.dirname(agreed.source), "shared.txt");
  await fs.writeFile(shared, "shared");
  await fs.writeFile(path.join(agreed.source, "..notes.txt"), "notes");
  const links = { "link.json": "agreed.json", "notes-link": "..notes.txt" };
  for (const [name, target] of Object.entries(links))
    await fs.symlink(target, path.join(agreed.source, name));
  await fs.symlink("../shared.txt", path.join(agreed.source, "shared.txt"));
  await fs.chmod(agreed.source, 0o555);
  await publish(agreed.built, agreed.source, "--pages", list).finally(() =>
    fs.chmod(agreed.source, 0o755),
  );
  const kept = path.join(sessionDir, "src", "1", "agreed");
  for (const [name, target] of Object.entries(links))
    assert.equal(await fs.readlink(path.join(kept, name)), target, name);
  assert.equal(
    await fs.readFile(path.join(kept, "shared.txt"), "utf8"),
    "shared",
  );
});

test("a --source that is a link is kept as the directory it names", async (t) => {
  const { sessionDir, agreed, overview, list, publish } =
    await sessionWithAgreed(t);
  await fs.mkdir(path.join(overview.source, "sub"));
  await fs.writeFile(path.join(overview.source, "sub", "own.txt"), "own");
  const link = `${overview.source}-link`;
  await fs.symlink(overview.source, link);
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
  const reply = `pair reply --session-dir ${session.directory} --thread ${id}`;
  assert(printed.split("\n")[0].includes(reply), printed);
  const thread = new RegExp(
    `<pair_thread id="${id}"[^>]*>([^]*?)</pair_thread>`,
  ).exec(printed)?.[1];
  for (const part of ["one result", "Why one result per input?"])
    assert(thread?.includes(part), printed);
  const post = (...args) => cli.run("reply", ...dir, "--thread", id, ...args);
  await post("--text", "So a retry can skip it: a - b, x*y and [1].");
  const file = path.join(root, "reply.html");
  await fs.writeFile(file, '<pre data-language="text">1 in, 1 out</pre>');
  await post("--file", file);
  await assert.rejects(post("--text", "x", "--file", file), { code: 1 });
  await assert.rejects(post(), { code: 1 });
  // The reviewer would see Markdown in --text as typed.
  for (const markdown of [
    "**bold**",
    "a [link](https://example.com)",
    "run `pair`",
    "one\n- two",
  ])
    await assert.rejects(post("--text", markdown), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /post it with --file/);
      return true;
    });
  const { threads } = (await session.status()).body;
  assert.deepEqual(threads[0].messages.slice(1), [
    {
      from: "agent",
      at: threads[0].messages[1].at,
      text: "So a retry can skip it: a - b, x*y and [1].",
    },
    {
      from: "agent",
      at: threads[0].messages[2].at,
      html: '<pre data-language="text">1 in, 1 out</pre>',
    },
  ]);
  const status = JSON.parse(await cli.run("status", ...dir, "--json"));
  assert.equal(status.threads, undefined);
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

// agreedFiles builds Agreed for round 1 with the given page list, as the agent
// does, and returns the pair publish arguments for it, which start the page
// named by start.
async function agreedFiles(directory, pages, start = pages[0].id) {
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
  return ["--file", file, "--pages", list, "--start", start];
}

test("pair start takes --reopen only with --session-dir, and creates no session without it", async (t) => {
  const h = await hub(t);
  const root = path.join(h.home, "cli");
  await fs.mkdir(root);
  const cli = await pairCli(root, {
    XDG_STATE_HOME: h.home,
    PAIR_HUB_PORT: "0",
  });
  await assert.rejects(cli.run("start", "--reopen"), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /--reopen only with --session-dir/);
    return true;
  });
  assert.deepEqual(await fs.readdir(h.config.sessions), []);
});

// pair start --title names a new session. The hub stores the name as the
// session's title, and the first Agreed replaces it with the plan's title.
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
  const agreed = await agreedFiles(
    root,
    [
      { id: "overview", title: "Overview" },
      { id: "detail", title: "Detail" },
      { id: "later", title: "Later" },
    ],
    "detail",
  );
  const published = await cli.run(
    "publish",
    ...dir,
    ...agreed,
    ...["--note", "Measuring"],
  );
  assert.match(published, /^Started: detail\.$/m);
  const pages = async () =>
    Object.fromEntries(
      (await state()).openRound.pages.map((page) => [page.id, page]),
    );
  assert.equal((await pages()).detail.note.text, "Measuring");
  // pair progress refuses the whole report when one page is unknown, and leaves
  // every page unchanged.
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
