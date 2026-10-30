import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configRoot } from "../shared/settings.mjs";

/** pair's components come first, then the user's. A user keeps components
    outside pair, because pair is installed and updated as a unit, and a
    component written into pair's directory would be an edit to installed
    software. */
export const componentRoots = () => [
  fileURLToPath(new URL("../components/", import.meta.url)),
  path.join(configRoot(), "components"),
];
/** The sort fixes the registration order. */
async function componentNames(root) {
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
/** A name in a later root replaces the same name in an earlier one, so a
    user can change a shipped component without forking pair. */
export async function componentDirectories(roots = componentRoots()) {
  const found = new Map();
  for (const [index, root] of roots.entries())
    for (const name of await componentNames(root))
      found.set(name, { name, directory: path.join(root, name), root: index });
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}
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
/* componentBehaviors wraps each behavior in a block, so the names a
   component declares at the top of its file stay inside the block and two
   components cannot collide over a name. The blocks run in the page's module
   script, which imports the frame helpers that components use from
   app/registry.mjs. */
export const componentBehaviors = (roots) =>
  componentParts(
    roots,
    "behavior.mjs",
    (at, text) => `/* ${at} */\n{\n${text}\n}`,
  );
