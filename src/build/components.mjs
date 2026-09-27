import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where a user keeps components of their own, outside pair. pair is
    installed and updated as a unit, so a component written into its own
    directory would be an edit to installed software. */
export function userComponents(env = process.env) {
  const home = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(home, "pair", "components");
}
export const componentRoots = () => [
  fileURLToPath(new URL("../components/", import.meta.url)),
  userComponents(),
];
/** The component directories, sorted, so registration order is fixed. */
async function componentNames(root) {
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
/** Every component, by name. A name in a later root replaces the same name
    in an earlier one, which is how a user changes a shipped component
    without forking pair. A root that does not exist contributes none. */
export async function componentDirectories(roots = componentRoots()) {
  const found = new Map();
  for (const [index, root] of roots.entries())
    for (const name of await componentNames(root))
      found.set(name, { name, directory: path.join(root, name), root: index });
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}
/** One named file from every component that has it, in name order. A
    component that ships no behavior, or no styles, is skipped rather than
    contributing an empty part. */
async function componentParts(roots, file, wrap) {
  const found = await componentDirectories(roots);
  const parts = await Promise.all(
    found.map(async ({ name, directory, root }) => {
      const text = await fs
        .readFile(path.join(directory, file), "utf8")
        .catch(() => "");
      const from = root === 0 ? `components/${name}` : `${name} (yours)`;
      return text.trim() ? wrap(`${from}/${file}`, text.trim()) : "";
    }),
  );
  return parts.filter(Boolean).join("\n");
}
export const componentStyles = (roots) =>
  componentParts(roots, "styles.css", (at, text) => `/* ${at} */\n${text}`);
/* Each behavior is evaluated in a block, so what a component declares at the
   top of its file stays inside it and two components cannot collide over a
   name. The frame's own helpers stay in scope, because the block is inside
   the frame's module. */
export const componentBehaviors = (roots) =>
  componentParts(
    roots,
    "behavior.mjs",
    (at, text) => `/* ${at} */\n{\n${text}\n}`,
  );
