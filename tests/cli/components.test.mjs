import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exec, pair, root } from "../support/hub.mjs";

// pair components is how an agent learns which components exist and when
// to use each, its own and the user's, and pair guide prints the markup the
// user's build uses.
test("pair components lists pair's components and yours, and pair guide prints each one's markup", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-components-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const yours = path.join(home, "pair", "components");
  const markup = {
    timeline: "<!-- Dated events in order along one axis -->\n<ol></ol>\n",
    decision: "<!-- Your decision rows -->\n<section></section>\n",
    unnamed: "<div></div>\n",
  };
  for (const [name, text] of Object.entries(markup)) {
    await fs.mkdir(path.join(yours, name), { recursive: true });
    await fs.writeFile(path.join(yours, name, "markup.html"), text);
  }
  const run = (...args) =>
    exec(process.execPath, [pair, ...args], {
      env: { ...process.env, XDG_CONFIG_HOME: home },
    });
  const { components } = JSON.parse((await run("components", "--json")).stdout);
  const shipped = (await fs.readdir(path.join(root, "src/components"))).filter(
    (name) => name !== "README.md",
  );
  const from = (owner) =>
    components.filter((item) => item.from === owner).map((item) => item.name);
  assert.deepEqual(from("pair"), shipped.sort());
  assert.deepEqual(from("yours"), ["decision", "timeline", "unnamed"]);
  const listed = (owner, name) =>
    components.find((item) => item.from === owner && item.name === name);
  // A component's use is the comment on the first line of its markup.
  assert.equal(
    listed("yours", "timeline").use,
    "Dated events in order along one axis",
  );
  assert.equal(listed("yours", "unnamed").use, null);
  assert(components.every((item) => item.from !== "pair" || item.use));
  // The command a component lists prints the markup a build uses: yours
  // where you have one of that name, and pair's otherwise.
  const markupOf = async (owner, name) =>
    (await run(...listed(owner, name).markup.split(" ").slice(1))).stdout;
  assert.equal(await markupOf("yours", "decision"), markup.decision);
  assert.equal(
    await markupOf("pair", "code"),
    await fs.readFile(
      path.join(root, "src/components/code/markup.html"),
      "utf8",
    ),
  );
  assert((await run("components")).stdout.includes(yours));
});
