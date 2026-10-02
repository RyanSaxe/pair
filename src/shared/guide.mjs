import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configRoot } from "./settings.mjs";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const markdownLink = /\[([^\]]*)\]\(([^()\s]+)\)/g;

// The command that prints a guide file, by the name pair guide takes.
export const guideCommand = (name) => `pair guide ${name}`;

// The files pair guide prints, by the name it takes: each Markdown file
// under guide/ by its path there, written with / on every platform, and the
// components README.
async function documents() {
  const guide = path.join(packageRoot, "guide");
  const names = new Map();
  for (const file of await fs.readdir(guide, { recursive: true }))
    if (file.endsWith(".md"))
      names.set(file.split(path.sep).join("/"), path.join(guide, file));
  names.set(
    "components/README.md",
    path.join(packageRoot, "src", "components", "README.md"),
  );
  return names;
}

// The guide's files link each other and the components by relative paths, so
// they read correctly in the repository. pair guide prints one file with each
// link to another guide file replaced by the command that prints it, and
// every other link as an absolute path, so the agent never resolves a
// relative path and pair writes nothing. The user's file at the same path
// under the config root follows pair's, after a blank line.
export async function guideText(name = "pair.md") {
  const names = await documents();
  const file = names.get(name);
  if (!file)
    throw new Error(
      `No guide file ${name}. The names are: ${[...names.keys()].sort().join(", ")}`,
    );
  const text = await fs.readFile(file, "utf8");
  const byFile = new Map([...names].map(([key, value]) => [value, key]));
  const own = text.replace(markdownLink, (_, label, target) => {
    const linked = path.resolve(path.dirname(file), target);
    const guide = byFile.get(linked);
    return guide
      ? `${label} (run \`${guideCommand(guide)}\`)`
      : `[${label}](${linked})`;
  });
  const yours = await fs
    .readFile(path.join(configRoot(), name), "utf8")
    .catch(() => "");
  const parts = [own, yours].map((part) => part.trimEnd()).filter(Boolean);
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}
