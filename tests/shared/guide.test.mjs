import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exists, killHub, pairCli, root } from "../support/hub.mjs";

const markdownLink = /\[[^\]]*\]\(([^()\s]+)\)/g;

const guideFiles = (await fs.readdir(path.join(root, "guide"))).filter((file) =>
  file.endsWith(".md"),
);

// The agent reads a guide text, then the files it links, and never resolves a
// path itself. Returns the files it read.
async function followGuide(text, from, read = new Set()) {
  const prose = text.replace(markdownLink, "");
  for (const name of guideFiles)
    assert(!prose.includes(name), `${from} names ${name} without a link`);
  for (const [, target] of text.matchAll(markdownLink)) {
    assert(path.isAbsolute(target), `${from} links ${target}`);
    assert(await exists(target), `${from} links ${target}`);
    if (target.endsWith(".md") && !read.has(target)) {
      read.add(target);
      await followGuide(await fs.readFile(target, "utf8"), target, read);
    }
  }
  return read;
}

test("the guide the next lines name links every file by its absolute path", async (t) => {
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
  const named = (next) => next.match(/ as (\S+) describes/)[1];
  const roundGuide = named(started.next);
  assert.equal(path.basename(roundGuide), "round.md");
  assert.equal(named(acked.next), roundGuide);
  const read = await followGuide(
    await fs.readFile(roundGuide, "utf8"),
    roundGuide,
  );
  assert(read.size > 0, "round.md links other guide files");
});

// The skill tells the agent to run pair guide, so what it prints is where
// every session starts.
test("pair guide prints guide/pair.md with every link an absolute path", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-guide-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const { run } = await pairCli(home);
  const printed = await run("guide");
  const withoutTargets = (markdown) =>
    markdown.replaceAll(/\]\([^()\s]+\)/g, "]()");
  assert.equal(
    withoutTargets(printed),
    withoutTargets(
      await fs.readFile(path.join(root, "guide", "pair.md"), "utf8"),
    ),
  );
  await followGuide(printed, "pair guide");
});

// Two installations of one version can share a state directory, such as a
// global install and an npx cache, or npm link moved to another checkout.
test("each installation's guide copy links only files that installation ships", async (t) => {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pair-installs-")),
  );
  const state = path.join(home, "state");
  let config;
  t.after(async () => {
    await killHub(config);
    await fs.rm(home, { recursive: true, force: true });
  });
  const { files } = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  for (const name of ["one", "two"]) {
    const install = path.join(home, name, "pair");
    for (const entry of ["package.json", ...files])
      await fs.cp(path.join(root, entry), path.join(install, entry), {
        recursive: true,
      });
    const cli = await pairCli(
      path.join(home, name),
      { XDG_STATE_HOME: state, PAIR_HUB_PORT: "0" },
      path.join(install, "src/cli.mjs"),
    );
    config = cli.config;
    const { next } = JSON.parse(await cli.run("start"));
    const copy = path.dirname(
      path.dirname(next.match(/ as (\S+) describes/)[1]),
    );
    for (const file of await fs.readdir(copy, { recursive: true })) {
      if (!file.endsWith(".md")) continue;
      const text = await fs.readFile(path.join(copy, file), "utf8");
      for (const [, target] of text.matchAll(markdownLink)) {
        const where = `${name}: ${file} links ${target}`;
        assert(
          target.startsWith(copy + path.sep) ||
            target.startsWith(install + path.sep),
          where,
        );
        assert(await exists(target), where);
      }
    }
  }
});
