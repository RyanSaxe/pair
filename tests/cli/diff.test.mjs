import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compareFiles } from "../../src/cli/diff.mjs";
import { exec, pair } from "../support/hub.mjs";

test("file comparison preserves exact sources and produces an applicable Git patch", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "plan-diff-"));
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
  // Git hands GIT_DIR to hooks, which would point apply at this repository.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const output = path.join(directory, "input.json");
  await exec(process.execPath, [pair, "diff", beforePath, afterPath, output], {
    env,
  });
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), result);
  const patchPath = path.join(directory, "change.patch");
  await fs.writeFile(patchPath, result.patch);
  await exec("git", ["apply", patchPath], {
    cwd: path.dirname(beforePath),
    env,
  });
  assert.equal(await fs.readFile(beforePath, "utf8"), after);
});

test("file comparison distinguishes identical input from a missing input", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "plan-diff-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, "input.txt");
  await fs.writeFile(input, "same\r\n");
  const result = await compareFiles(input, input);
  assert.equal(result.patch, "");
  assert.equal(result.before, "same\r\n");
  assert.equal(result.after, "same\r\n");
  await assert.rejects(
    compareFiles(input, path.join(directory, "missing.txt")),
    { code: "ENOENT" },
  );
});
