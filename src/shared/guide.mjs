import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { componentDirectories } from "../build/components.mjs";
import { configRoot } from "./settings.mjs";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

export const guideCommand = (name) => `pair guide ${name}`;

// componentDirectories() returns the user's component in place of pair's when
// both have one name, so pair guide prints the user's markup for that
// component.
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

// guideText() returns a guide file as it is in the repository, because a guide
// file refers to each other file by the pair guide command that prints it, and
// the agent never resolves a path. For a Markdown file, the user's file at the
// same path under the config root follows after a blank line.
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
