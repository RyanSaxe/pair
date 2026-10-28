import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { refuseOverwrite } from "./output.mjs";

const run = promisify(execFile);

/* git applies the attributes and config of the repository it runs in and
   of the user, and core.autocrlf or an eol attribute turns CRLF into LF
   before it compares, so a change of line endings alone came out as no
   change. git runs in a new empty directory, with no repository above it
   and no config but the settings here, so pair diff writes the same patch
   wherever it runs. */
async function gitDiff(paths) {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "pair-diff-"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  try {
    const { stdout } = await run(
      "git",
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.safecrlf=false",
        "-c",
        "core.attributesFile=/dev/null",
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        ...paths,
      ],
      {
        cwd: directory,
        env: {
          ...env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CEILING_DIRECTORIES: path.dirname(directory),
        },
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return stdout;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function compareFiles(beforePath, afterPath) {
  const paths = [beforePath, afterPath].map((file) => path.resolve(file));
  const [before, after] = await Promise.all(
    paths.map((file) => fs.readFile(file, "utf8")),
  );
  if (before.includes("\0") || after.includes("\0"))
    throw Error(
      "pair diff compares text files, and BEFORE or AFTER is a binary file.",
    );
  let patch;
  try {
    patch = await gitDiff(paths);
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
  await fs
    .writeFile(output, JSON.stringify(input, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    })
    .catch(refuseOverwrite(output));
  const written = path.resolve(output);
  return {
    next: `Name ${path.basename(written)} in data-diff-input on the textarea of a before-after component, as pair guide components/before-after/markup.html shows, and keep the file in the page source's directory.`,
    data: `Wrote ${written}`,
    json: { output: written },
  };
}
