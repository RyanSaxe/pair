import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compareFiles } from "../../src/cli/diff.mjs";
import { exec, exists, pair } from "../support/hub.mjs";

// Git passes GIT_DIR and the other GIT_* variables to hooks, and they would
// point the test's git commands at this repository.
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
  assert.match(result.patch, /^diff --git a\/cli\.py b\/cli\.py$/m);
  assert(!result.patch.includes(directory));
  const output = path.join(directory, "input.json");
  await exec(process.execPath, [pair, "diff", beforePath, afterPath, output], {
    env: withoutGit,
  });
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), result);
  const patchPath = path.join(directory, "change.patch");
  await fs.writeFile(patchPath, result.patch);
  // Git for Windows turns on core.autocrlf, and git apply would then write CRLF
  // line endings.
  await exec("git", ["-c", "core.autocrlf=false", "apply", patchPath], {
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

test("pair diff refuses to overwrite an existing output", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-diff-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const [before, after, output] = ["before.txt", "after.txt", "input.json"].map(
    (name) => path.join(directory, name),
  );
  await fs.writeFile(before, "one\n");
  await fs.writeFile(after, "two\n");
  await fs.writeFile(output, "keep");
  await assert.rejects(
    exec(process.execPath, [pair, "diff", before, after, output], {
      env: withoutGit,
    }),
    /already exists, and pair never overwrites a file/,
  );
  assert.equal(await fs.readFile(output, "utf8"), "keep");
});

// pair diff once wrote an empty patch for a change of line endings alone.
// Inside a repository whose .gitattributes sets eol=lf, or for a user whose Git
// config sets core.autocrlf, git turned CRLF into LF before it compared the
// files.
test("pair diff writes the same patch inside a repository and for a user whose Git config converts line endings", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-diff-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = path.join(directory, "repository");
  const home = path.join(directory, "home");
  await fs.mkdir(repository);
  await fs.mkdir(home);
  await exec("git", ["init", "--quiet"], { cwd: repository, env: withoutGit });
  const { stdout: top } = await exec("git", ["rev-parse", "--show-toplevel"], {
    cwd: repository,
    env: withoutGit,
  });
  // On Windows git prints the path with forward slashes, so the test compares
  // the realpath of each side.
  assert.equal(await fs.realpath(top.trim()), await fs.realpath(repository));
  await fs.writeFile(
    path.join(repository, ".gitattributes"),
    "* text=auto eol=lf\n",
  );
  await fs.writeFile(
    path.join(home, ".gitconfig"),
    "[core]\n\tautocrlf = input\n",
  );
  const before = path.join(repository, "before", "mixed.txt");
  const after = path.join(repository, "after", "mixed.txt");
  for (const [file, text] of [
    [before, "one\ntwo\n"],
    [after, "one\r\ntwo\r\n"],
  ]) {
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(file, text);
  }
  const diff = async (cwd, env, name) => {
    const output = path.join(directory, name);
    await exec(process.execPath, [pair, "diff", before, after, output], {
      cwd,
      env,
    });
    return JSON.parse(await fs.readFile(output, "utf8"));
  };
  const inside = await diff(
    repository,
    { ...withoutGit, HOME: home, XDG_CONFIG_HOME: home },
    "inside.json",
  );
  const outside = await diff(directory, withoutGit, "outside.json");
  assert.ok(
    inside.patch.endsWith("@@ -1,2 +1,2 @@\n-one\n-two\n+one\r\n+two\r\n"),
    inside.patch,
  );
  assert.deepEqual(outside, inside);
});
