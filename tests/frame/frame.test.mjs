import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { libraries } from "../../src/shared/libraries.mjs";

test("the build's language list is the one for the Shiki the frame loads", async () => {
  const list = JSON.parse(
    await fs.readFile(
      new URL("../../src/build/shiki-languages.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(libraries.shiki.match(/esm\.sh\/shiki@([\d.]+)/)[1], list.shiki);
});
