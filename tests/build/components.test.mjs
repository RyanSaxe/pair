import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exec, pair } from "../support/hub.mjs";

const shipped = new URL(
  "../../src/components/question/styles.css",
  import.meta.url,
);

// A directory under $XDG_CONFIG_HOME/pair/components with the name of one of
// pair's components replaces it in every page pair build writes.
test("a user component replaces pair's in a built page", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-components-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const yours = path.join(home, "config", "pair", "components");
  await fs.mkdir(path.join(yours, "question"), { recursive: true });
  const styles = ".question { outline: 3px solid red; }";
  await fs.writeFile(path.join(yours, "question", "styles.css"), styles);
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: path.join(home, "config"),
  };
  const source = path.join(home, "page.json");
  await fs.writeFile(
    source,
    JSON.stringify({
      name: "t",
      round: "1",
      title: "T",
      page: { id: "p", title: "P", html: "<p>x</p>" },
    }),
  );
  const output = path.join(home, "page.html");
  await exec(process.execPath, [pair, "build", source, output], { env });
  const html = await fs.readFile(output, "utf8");
  assert.ok(html.includes(styles), "the user's question styles");
  assert.ok(
    !html.includes((await fs.readFile(shipped, "utf8")).trim()),
    "pair's question styles",
  );
});
