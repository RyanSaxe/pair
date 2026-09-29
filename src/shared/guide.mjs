import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { offers } from "./offers.mjs";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const markdownLink = /\[([^\]]*)\]\(([^()\s]+)\)/g;

// The command that prints a guide file, by the name pair guide takes.
export const guideCommand = (name) => `pair guide ${name}`;

// The files pair guide prints, by the name it takes: the path under guide/,
// written with / on every platform, and components/README.md for the
// components README.
async function documents() {
  const names = new Map();
  for (const file of await fs.readdir(path.join(packageRoot, "guide")))
    if (file.endsWith(".md"))
      names.set(file, path.join(packageRoot, "guide", file));
  for (const offer of Object.values(offers))
    names.set(
      path.posix.relative("guide", offer.guide),
      path.join(packageRoot, offer.guide),
    );
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
// relative path and pair writes nothing.
export async function guideText(name = "pair.md") {
  const names = await documents();
  const file = names.get(name);
  if (!file)
    throw new Error(
      `No guide file ${name}. The names are: ${[...names.keys()].sort().join(", ")}`,
    );
  const byFile = new Map([...names].map(([key, value]) => [value, key]));
  const text = await fs.readFile(file, "utf8");
  return text.replace(markdownLink, (_, label, target) => {
    const linked = path.resolve(path.dirname(file), target);
    const guide = byFile.get(linked);
    return guide
      ? `${label} (run \`${guideCommand(guide)}\`)`
      : `[${label}](${linked})`;
  });
}
