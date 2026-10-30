import "../support/env.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../src/cli/build.mjs";

const root = new URL("../../src/components/", import.meta.url);

// A plan author copies a component's markup.html into a page, so each
// markup.html must build as a page on its own. The test supplies a prototype
// for each data-prototype ID and writes a diff file for each data-diff-input
// name, as the page's author would.
test("every component's markup.html builds as it is written", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-markup-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const components = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const name of components) {
    const html = await fs.readFile(
      new URL(`${name}/markup.html`, root),
      "utf8",
    );
    const prototypes = [...html.matchAll(/data-prototype="([^"]+)"/g)].map(
      ([, id]) => ({ id, title: id, html: "<p>x</p>", height: 100 }),
    );
    for (const [, file] of html.matchAll(/data-diff-input="([^"]+)"/g))
      await fs.writeFile(
        path.join(directory, file),
        '{"before":"","after":"","patch":""}',
      );
    await assert.doesNotReject(
      buildPage(path.join(directory, "markup.json"), {
        name: "markup",
        round: "1",
        title: "Markup",
        page: { id: "p", title: "P", html, prototypes },
      }),
      name,
    );
  }
});
