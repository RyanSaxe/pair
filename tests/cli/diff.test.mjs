import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compareFiles } from "../../src/cli/diff.mjs";
import { exec, exists, pair } from "../support/hub.mjs";

// Git hands GIT_DIR to hooks, which would point git at this repository.
const withoutGit = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

test("file comparison preserves exact sources and produces an applicable Git patch", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-diff-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const beforePath = path.join(directory, "before", "cli.py");
  const afterPath = path.join(directory, "after", "cli.py");
  const before = "α <tag>\nunchanged\n";
  const after = "α <tag> changed\nunchanged\nno final newline";
  for (const [file, text] of [
    [beforePath, before],
    [afterPath, after],
  ]) {
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(file, text);
  }
  const result = await compareFiles(beforePath, afterPath);
  assert.equal(result.before, before);
  assert.equal(result.after, after);
  // The patch names the file, not the scratch paths it was made from.
  assert.match(result.patch, /^diff --git a\/cli\.py b\/cli\.py$/m);
  assert(!result.patch.includes(directory));
  const output = path.join(directory, "input.json");
  await exec(process.execPath, [pair, "diff", beforePath, afterPath, output], {
    env: withoutGit,
  });
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), result);
  const patchPath = path.join(directory, "change.patch");
  await fs.writeFile(patchPath, result.patch);
  await exec("git", ["apply", patchPath], {
    cwd: path.dirname(beforePath),
    env: withoutGit,
  });
  assert.equal(await fs.readFile(beforePath, "utf8"), after);
});

test("pair diff gives identical files an empty patch and names a missing file", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-diff-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, "input.txt");
  await fs.writeFile(input, "same\r\n");
  const diff = (after, output) =>
    exec(process.execPath, [pair, "diff", input, after, output], {
      env: withoutGit,
    });
  const same = path.join(directory, "same.json");
  await diff(input, same);
  assert.deepEqual(JSON.parse(await fs.readFile(same, "utf8")), {
    before: "same\r\n",
    after: "same\r\n",
    patch: "",
  });
  const refused = path.join(directory, "refused.json");
  await assert.rejects(
    diff(path.join(directory, "missing.txt"), refused),
    /no such file or directory, open '.*missing\.txt'/,
  );
  assert.equal(await exists(refused), false);
});
