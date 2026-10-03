import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { componentDirectories } from "../build/components.mjs";
import { configRoot } from "./settings.mjs";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

// The command that prints a guide file, by the name pair guide takes.
export const guideCommand = (name) => `pair guide ${name}`;

// The files pair guide prints, by the name it takes: each Markdown file and
// SVG under guide/ by its path there, written with / on every platform, the
// components README, and each component's markup, which is the user's when
// they have a component of that name.
async function documents() {
  const guide = path.join(packageRoot, "guide");
  const names = new Map();
  for (const file of await fs.readdir(guide, { recursive: true }))
    if (/\.(md|svg)$/.test(file))
      names.set(file.split(path.sep).join("/"), path.join(guide, file));
  names.set(
    "components/README.md",
    path.join(packageRoot, "src", "components", "README.md"),
  );
  for (const { name, directory } of await componentDirectories())
    names.set(
      `components/${name}/markup.html`,
      path.join(directory, "markup.html"),
    );
  return names;
}

// pair guide prints a file exactly as it is in the repository. A guide file
// names each other file by the pair guide command that prints it, so the
// agent never resolves a path. The user's file at the same path under the
// config root follows a Markdown file, after a blank line.
export async function guideText(name = "pair.md") {
  const names = await documents();
  const file = names.get(name);
  if (!file)
    throw new Error(
      `No guide file ${name}. The names are: ${[...names.keys()].sort().join(", ")}`,
    );
  const own = await fs.readFile(file, "utf8");
  if (!name.endsWith(".md")) return own;
  const yours = await fs
    .readFile(path.join(configRoot(), name), "utf8")
    .catch(() => "");
  const parts = [own, yours].map((part) => part.trimEnd()).filter(Boolean);
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}
