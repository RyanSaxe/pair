import "../support/env.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../src/cli/build.mjs";

const root = new URL("../../src/components/", import.meta.url);

// A plan author copies a component's markup.html into a page, so each one
// builds as the whole of a page. The prototype component names a prototype,
// and the page supplies one under that ID.
test("every component's markup.html builds as it is written", async () => {
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
    await assert.doesNotReject(
      buildPage(path.join(os.tmpdir(), "markup.json"), {
        name: "markup",
        round: "1",
        title: "Markup",
        page: { id: "p", title: "P", html, prototypes },
      }),
      name,
    );
  }
});
