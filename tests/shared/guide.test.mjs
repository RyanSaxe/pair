import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exec, exists, killHub, pair, pairCli, root } from "../support/hub.mjs";

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
  const { config, run } = await pairCli(home, { PAIR_HUB_PORT: "0" });
  t.after(async () => {
    await killHub(config);
    await fs.rm(home, { recursive: true, force: true });
  });
  const started = JSON.parse(await run("start"));
  const acked = JSON.parse(
    await run("ack", "--session-dir", started.sessionDir),
  );
  for (const next of [started.next, acked.next])
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
  ).filter((file) => file.endsWith(".md"));
  assert.deepEqual(names, [...files, "components/README.md"].sort());
  const reached = new Set();
  for (const name of names)
    if (!reached.has(name)) {
      reached.add(name);
      await followGuide(print, name, reached);
    }
  assert.deepEqual(await fs.readdir(state), []);
});
