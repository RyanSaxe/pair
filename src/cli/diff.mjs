import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function compareFiles(beforePath, afterPath) {
  const paths = [beforePath, afterPath].map((file) => path.resolve(file));
  const [before, after] = await Promise.all(
    paths.map((file) => fs.readFile(file, "utf8")),
  );
  if (before.includes("\0") || after.includes("\0"))
    throw Error("The diff viewer accepts text files, not binary files.");
  let patch;
  try {
    ({ stdout: patch } = await run(
      "git",
      [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        ...paths,
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch (error) {
    if (error.code === 1) patch = error.stdout;
    else if (error.code === "ENOENT")
      throw Error("Git is required to generate a diff.");
    else throw Error(error.stderr?.trim() || error.message);
  }
  return { before, after, patch: named(patch, path.basename(paths[1])) };
}

/* git names both sides by the paths it was given, which for scratch copies
   are absolute temp paths the reader sees in the patch. The headers name
   the file instead, as a patch from the file's own repository would. */
function named(patch, name) {
  const lines = patch.split("\n");
  for (let i = 0; i < lines.length && !lines[i].startsWith("@@"); i++) {
    if (lines[i].startsWith("diff --git "))
      lines[i] = `diff --git a/${name} b/${name}`;
    else if (lines[i].startsWith("--- ")) lines[i] = `--- a/${name}`;
    else if (lines[i].startsWith("+++ ")) lines[i] = `+++ b/${name}`;
  }
  return lines.join("\n");
}

export async function main({ args: [before, after, output] }) {
  const input = await compareFiles(before, after);
  await fs.writeFile(output, JSON.stringify(input, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const written = path.resolve(output);
  return {
    next: `Put the file's JSON in the data-diff-input textarea of a before-after component, as pair guide components/before-after/markup.html shows.`,
    data: `Wrote ${written}`,
    json: { output: written },
  };
}
