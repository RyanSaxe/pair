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

// The pattern matches a Markdown link with no URL scheme. The agent cannot
// resolve such a link, because pair guide prints a file as it is, and the agent
// does not know the file's directory.
const relativeLink = /\[[^\]]*\]\((?![a-z][a-z+.-]*:)[^()\s]+\)/gi;
const guideRun = /pair guide ([\w./-]+\.(?:md|html|svg))/g;
const guideNames = (await fs.readdir(path.join(root, "guide"))).filter((file) =>
  file.endsWith(".md"),
);

const printer = (state) => async (name) =>
  (
    await exec(process.execPath, [pair, "guide", ...(name ? [name] : [])], {
      env: { ...process.env, XDG_STATE_HOME: state },
    })
  ).stdout;

// followGuide reads the guide the way the agent does. It prints a file, runs
// each pair guide command in the printed text, and never resolves a path. It
// fails on a relative link in a printed Markdown file and on a guide file named
// without its command. It returns the set of names it printed.
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

// The text that pair start prints contains a pair guide command for each file
// the agent reads before round 1. The test fails when one of those files no
// longer prints.
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

// The installed skill contains the instruction to run pair guide, so every
// session starts from its output. pair guide writes nothing, so it also runs
// where the state directory is read-only.
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

// For any guide file or moment, the user can add a file at the same path under
// $XDG_CONFIG_HOME/pair/, and pair prints it after pair's own text.
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
  const moment = (await cli.run("guide", "moments/read-thread.md")).trimEnd();
  assert(!moment.startsWith("Your"), "pair's read-thread.md comes first");
  assert(moment.endsWith("Your thread rule."), moment);
  const at = thread.indexOf(moment);
  assert(at >= 0 && at < thread.indexOf("<pair_thread "), thread);
});
