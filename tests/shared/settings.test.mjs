import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { exec, root } from "../support/hub.mjs";

// A hub restarts on newer code only when its version changes, and the hub
// runs the build as well as its own modules.
test("the hub version changes when any file the hub runs changes", async (t) => {
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), "pair-version-"));
  t.after(() => fs.rm(copy, { recursive: true, force: true }));
  const { files } = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  for (const entry of ["package.json", ...files])
    await fs.cp(path.join(root, entry), path.join(copy, entry), {
      recursive: true,
    });
  const settings = pathToFileURL(path.join(copy, "src/shared/settings.mjs"));
  const version = async () =>
    (
      await exec(process.execPath, [
        "--input-type=module",
        "-e",
        `import { version } from "${settings}"; console.log(version);`,
      ])
    ).stdout;
  const before = await version();
  await fs.appendFile(path.join(copy, "src/build/lint.mjs"), "\n// edited\n");
  assert.notEqual(await version(), before);
});
