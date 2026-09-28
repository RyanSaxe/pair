import assert from "node:assert/strict";
import { test } from "node:test";
import { nextVersion } from "../.github/scripts/next-version.mjs";

test("a merge into main publishes the next version its labels ask for", () => {
  assert.equal(nextVersion(null, []), "0.1.0");
  assert.equal(nextVersion("0.1.0", []), "0.1.1");
  assert.equal(nextVersion("0.1.7", ["minor"]), "0.2.0");
  assert.equal(nextVersion("0.4.2", ["major", "minor"]), "1.0.0");
  assert.equal(nextVersion("1.2.3", ["documentation"]), "1.2.4");
  assert.equal(nextVersion("0.1.0", ["skip-release", "minor"]), null);
});
