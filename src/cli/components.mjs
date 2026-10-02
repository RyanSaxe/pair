import fs from "node:fs/promises";
import path from "node:path";
import { componentDirectories, componentRoots } from "../build/components.mjs";
import { guideCommand } from "../shared/guide.mjs";

// A component's use is the first line of its markup.html, when that line is
// one whole HTML comment.
async function use(directory) {
  const markup = await fs
    .readFile(path.join(directory, "markup.html"), "utf8")
    .catch(() => "");
  return /^<!--\s*(.*?)\s*-->$/.exec(markup.split("\n")[0])?.[1] || null;
}

async function listed(root, from) {
  return Promise.all(
    (await componentDirectories([root])).map(async ({ name, directory }) => ({
      name,
      use: await use(directory),
      from,
      markup: guideCommand(`components/${name}/markup.html`),
    })),
  );
}

// Every component, pair's and then the user's, one line each.
export async function components() {
  const [ownRoot, yoursRoot] = componentRoots();
  const own = await listed(ownRoot, "pair");
  const yours = await listed(yoursRoot, "yours");
  const shipped = new Set(own.map((item) => item.name));
  const all = [...own, ...yours];
  const nameWidth = Math.max(...all.map((item) => item.name.length)) + 2;
  const useText = (item) =>
    [
      item.use,
      item.from === "yours" && shipped.has(item.name) && "(replaces pair's)",
    ]
      .filter(Boolean)
      .join(" ");
  const useWidth = Math.max(...all.map((item) => useText(item).length)) + 2;
  const line = (item) =>
    `${item.name.padEnd(nameWidth)}${useText(item).padEnd(useWidth)}${item.markup}`;
  const count = `${own.length} components from pair${yours.length ? ` and ${yours.length} of yours` : ""}.`;
  return {
    next: "Print a component's markup with the pair guide command on its line, copy it into the page, and replace its content and IDs.",
    data: [
      count,
      ["pair's components", ...own.map(line)].join("\n"),
      ...(yours.length
        ? [[`Yours, in ${yoursRoot}`, ...yours.map(line)].join("\n")]
        : []),
    ].join("\n\n"),
    json: { components: all },
  };
}
