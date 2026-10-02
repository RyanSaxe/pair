import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { offers } from "../../src/shared/offers.mjs";
import {
  exec,
  exists,
  hub,
  killHub,
  pair,
  pairCli,
  planData,
  root,
} from "../support/hub.mjs";

const markdownLink = /\[[^\]]*\]\(([^()\s]+)\)/g;
const guideRun = /\(run `pair guide (\S+)`\)/g;
const guideNames = (await fs.readdir(path.join(root, "guide"))).filter((file) =>
  file.endsWith(".md"),
);
const source = (name) =>
  name === "components/README.md"
    ? path.join(root, "src/components/README.md")
    : path.join(root, "guide", name);

// pair guide as the agent runs it, with the state directory at state.
const printer = (state) => async (name) =>
  (
    await exec(process.execPath, [pair, "guide", ...(name ? [name] : [])], {
      env: { ...process.env, XDG_STATE_HOME: state },
    })
  ).stdout;

// The agent reads a printed guide file, then the files it names, and never
// resolves a path itself. Each pair guide command in the text names a file
// that prints, each other link is an absolute path that exists, and a guide
// file is named only in a link, which prints as that command. Returns the
// names it printed.
async function followGuide(print, name, printed = new Set([name])) {
  const text = await print(name);
  const prose = (await fs.readFile(source(name), "utf8")).replace(
    markdownLink,
    "",
  );
  for (const guide of guideNames)
    assert(!prose.includes(guide), `${name} names ${guide} without a link`);
  for (const [, target] of text.matchAll(markdownLink)) {
    assert(path.isAbsolute(target), `${name} links ${target}`);
    assert(await exists(target), `${name} links ${target}`);
  }
  for (const [, next] of text.matchAll(guideRun))
    if (!printed.has(next)) {
      printed.add(next);
      await followGuide(print, next, printed);
    }
  return printed;
}

test("the next lines name round.md by the command that prints it", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-guide-"));
  const { config, run, start } = await pairCli(home, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(home, { recursive: true, force: true });
  });
  const started = await start();
  const read = JSON.parse(
    await run("read", "--session-dir", started.sessionDir, "--json"),
  );
  for (const next of [started.next, read.next])
    assert.match(next, /\bpair guide round\.md\b/);
  const printed = await followGuide(printer(home), "round.md");
  assert(printed.size > 1, "round.md names other guide files");
});

// The skill tells the agent to run pair guide, so what it prints is where
// every session starts. Printing writes nothing, so it works where the
// state directory cannot be written.
test("pair guide prints guide/pair.md and every guide file, and writes nothing", async (t) => {
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
  // Every file prints, including one that only a next line names, such as
  // offers/finish.md, which no guide link reaches.
  const files = (
    await fs.readdir(path.join(root, "guide"), { recursive: true })
  )
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.split(path.sep).join("/"));
  assert.deepEqual(names, [...files, "components/README.md"].sort());
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
  await fs.writeFile(path.join(config, "pair", "round.md"), "Your round.\n");
  await fs.writeFile(
    path.join(config, "pair", "moments", "read-thread.md"),
    "Your thread rule.\n",
  );
  const round = await cli.run("guide", "round.md");
  assert(round.startsWith("# "), "pair's round.md comes first");
  assert(round.trimEnd().endsWith("Your round."), "yours follows");

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
  const own = (
    await fs.readFile(path.join(root, "guide/moments/read-thread.md"), "utf8")
  ).trim();
  assert(own, "read-thread.md has text");
  // pair's moment, then yours, both before the thread.
  const order = [own, "Your thread rule.", "<pair_thread "].map((part) =>
    thread.indexOf(part),
  );
  assert(order[0] >= 0 && order[0] < order[1] && order[1] < order[2], thread);

  // The hub names each acceptance's moment by its action, so each one prints.
  for (const offer of Object.values(offers))
    for (const action of offer.accept.actions)
      await cli.run("guide", `moments/read-accept-${action.id}.md`);
});
