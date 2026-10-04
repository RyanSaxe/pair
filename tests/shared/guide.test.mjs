import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  exec,
  hub,
  killHub,
  pair,
  pairCli,
  planData,
  root,
} from "../support/hub.mjs";

// A Markdown link whose target has no scheme, which the agent would have to
// resolve against a directory it does not know.
const relativeLink = /\[[^\]]*\]\((?![a-z][a-z+.-]*:)[^()\s]+\)/gi;
const guideRun = /pair guide ([\w./-]+\.(?:md|html|svg))/g;
const guideNames = (await fs.readdir(path.join(root, "guide"))).filter((file) =>
  file.endsWith(".md"),
);

// pair guide as the agent runs it, with the state directory at state.
const printer = (state) => async (name) =>
  (
    await exec(process.execPath, [pair, "guide", ...(name ? [name] : [])], {
      env: { ...process.env, XDG_STATE_HOME: state },
    })
  ).stdout;

// The agent reads a printed guide file, then runs each pair guide command it
// names, and never resolves a path itself. A printed Markdown file contains
// no relative link and names a guide file only by its command, and each
// command names a file that prints. Returns the names it printed.
async function followGuide(print, name, printed = new Set([name])) {
  const text = await print(name);
  if (name.endsWith(".md")) {
    assert.deepEqual(
      [...text.matchAll(relativeLink)].map(([link]) => link),
      [],
      `${name} has a relative link`,
    );
    const prose = text.replaceAll(guideRun, "");
    for (const guide of guideNames)
      assert(
        !prose.includes(guide),
        `${name} names ${guide} without its command`,
      );
  }
  for (const [, next] of text.matchAll(guideRun))
    if (!printed.has(next)) {
      printed.add(next);
      await followGuide(print, next, printed);
    }
  return printed;
}

// pair start prints the start moment, which names the guide files to read
// before round 1, so a file it names that no longer prints fails here.
test("every guide file the start output names prints", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-guide-"));
  const { config, run } = await pairCli(home, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(home, { recursive: true, force: true });
  });
  const started = await run("start", "--title", "Guide");
  const named = [...started.matchAll(guideRun)].map(([, name]) => name);
  assert(named.length > 0, started);
  const printed = new Set(named);
  for (const name of named) await followGuide(printer(home), name, printed);
});

// The skill tells the agent to run pair guide, so what it prints is where
// every session starts. Printing writes nothing, so it works where the
// state directory cannot be written.
test("pair guide prints guide/pair.md and every guide file, with no relative link, and writes nothing", async (t) => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "pair-guide-"));
  t.after(() => fs.rm(state, { recursive: true, force: true }));
  const print = printer(state);
  const printed = await print();
  assert.deepEqual(await fs.readdir(state), []);
  assert.equal(printed.split("\n")[0], "# Pair");
  assert.equal(printed, await print("pair.md"));
  let names;
  await assert.rejects(print("nowhere.md"), ({ stderr }) => {
    const refusal = /^pair: No guide file nowhere\.md\. The names are: (.+)\n$/;
    names = stderr.match(refusal)?.[1].split(", ");
    assert(names, stderr);
    return true;
  });
  // Every file prints, including a moment, which only a command names.
  const files = (
    await fs.readdir(path.join(root, "guide"), { recursive: true })
  )
    .filter((file) => /\.(md|svg)$/.test(file))
    .map((file) => file.split(path.sep).join("/"));
  const markup = (await fs.readdir(path.join(root, "src/components")))
    .filter((name) => name !== "README.md")
    .map((name) => `components/${name}/markup.html`);
  assert.deepEqual(names, [...files, "components/README.md", ...markup].sort());
  const reached = new Set();
  for (const name of names)
    if (!reached.has(name)) {
      reached.add(name);
      await followGuide(print, name, reached);
    }
  assert.deepEqual(await fs.readdir(state), []);
});

// Every guide file and every moment's text has an optional file of the
// user's at the same path under $XDG_CONFIG_HOME/pair/, which prints after
// pair's own.
test("pair guide and a command's moment print your file after pair's", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-yours-"));
  const config = path.join(home, "config");
  const h = await hub(t);
  const cli = await pairCli(home, {
    XDG_STATE_HOME: h.home,
    XDG_CONFIG_HOME: config,
    PAIR_HUB_PORT: "0",
  });
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(config, "pair", "moments"), { recursive: true });
  await fs.writeFile(
    path.join(config, "pair", "agreements.md"),
    "Your agreements.\n",
  );
  await fs.writeFile(
    path.join(config, "pair", "moments", "read-thread.md"),
    "Your thread rule.\n",
  );
  const agreements = await cli.run("guide", "agreements.md");
  assert(agreements.startsWith("# "), "pair's agreements.md comes first");
  assert(agreements.trimEnd().endsWith("Your agreements."), "yours follows");

  const session = await h.session({ cli });
  assert.equal((await session.publish(planData())).code, 200);
  const started = await session.request(`${session.base}/api/threads`, {
    id: "question-1",
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "Why?",
  });
  assert.equal(started.code, 201, started.body.error);
  const thread = await cli.run(
    "read",
    "--session-dir",
    session.directory,
    "--thread",
    "question-1",
  );
  // pair guide prints pair's moment, then yours, and pair read --thread
  // prints the same text before the thread.
  const moment = (await cli.run("guide", "moments/read-thread.md")).trimEnd();
  assert(!moment.startsWith("Your"), "pair's read-thread.md comes first");
  assert(moment.endsWith("Your thread rule."), moment);
  const at = thread.indexOf(moment);
  assert(at >= 0 && at < thread.indexOf("<pair_thread "), thread);
});
