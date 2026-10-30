import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { moduleIntegrity } from "../shared/libraries.mjs";
import { readPlanData } from "../shared/records.mjs";
import { jsonScript, jsonScriptTag, scriptJson } from "../shared/util.mjs";
import {
  componentBehaviors,
  componentRoots,
  componentStyles,
} from "./components.mjs";
import { problems } from "./lint.mjs";

const assets = new URL("../frame/", import.meta.url);
const read = (name) => fs.readFile(new URL(name, assets), "utf8");

async function* files(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* files(file);
    else yield file;
  }
}
async function frameModules() {
  const root = fileURLToPath(assets);
  const modules = {};
  const names = [];
  for await (const file of files(root))
    if (file.endsWith(".mjs"))
      names.push(path.relative(root, file).split(path.sep).join("/"));
  for (const name of names.sort()) modules[`#frame/${name}`] = await read(name);
  const shared = new Set(
    Object.values(modules).flatMap((text) =>
      [...text.matchAll(/from "(#shared\/[^"]+)"/g)].map((match) => match[1]),
    ),
  );
  for (const name of [...shared].sort())
    modules[name] = await read(`../shared/${name.slice("#shared/".length)}`);
  return modules;
}
// A later stylesheet in this list wins a tie of specificity, so the list is the
// frame's cascade order.
const stylesheets = [
  "app/tokens.css",
  "app/base.css",
  "app/shell.css",
  "pages/page-list.css",
  "pages/reading.css",
  "sync/activity.css",
  "review/review.css",
  "notes/threads.css",
  "pages/agreed.css",
  "pages/work.css",
  "pages/diagram.css",
  "app/dialogs.css",
  "app/modes.css",
];
export async function frameBundle() {
  const roots = componentRoots();
  const [
    shell,
    dialogs,
    style,
    modules,
    drawingEditor,
    componentCss,
    componentJs,
  ] = await Promise.all([
    read("app/shell.html"),
    read("app/dialogs.html"),
    Promise.all(stylesheets.map(read)).then((texts) => texts.join("\n")),
    frameModules(),
    read("notes/drawing-editor.html"),
    componentStyles(roots),
    componentBehaviors(roots),
  ]);
  return {
    format: 2,
    shell,
    dialogs,
    style,
    modules,
    drawingEditor,
    componentCss,
    componentJs,
  };
}
// Component behaviors use these names without importing them.
// src/frame/app/registry.mjs re-exports each name from the module that declares
// it.
const componentNames = [
  "$",
  "base",
  "canComment",
  "canSketch",
  "color",
  "commentOn",
  "copyButton",
  "diagramBox",
  "diagrams",
  "failed",
  "figure",
  "libraries",
  "lineRanges",
  "linkButton",
  "online",
  "openSketch",
  "page",
  "pages",
  "plan",
  "readData",
  "script",
  "show",
  "syntaxThemes",
  "uuid",
];
// A module in a data: URL has no base URL, so the frame's modules import each
// other by #frame/… and #shared/… names, and the browser resolves those names
// through the import map.
function moduleScript({ modules, componentJs }) {
  const imports = {};
  for (const [name, text] of Object.entries(modules)) {
    const source = `${text}\n//# sourceURL=${name.slice(1)}\n`;
    imports[name] =
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  }
  return (
    `<script type="importmap">\n${JSON.stringify({ imports, integrity: moduleIntegrity })}\n</script>\n` +
    `<script type="module">\n` +
    `import { ${componentNames.join(", ")} } from "#frame/app/registry.mjs";\n` +
    `import "#frame/app/boot.mjs";\n${componentJs}\n</script>`
  );
}
// The hub stores the frame bundle with a round when it publishes the round's
// Agreed, so an old round can have an older bundle. A bundle with no format
// predates the frame's split into modules, and its files expect one shared
// scope, so joinedScript() joins them into one module script.
const joinedScript = (bundle) =>
  `<script type="module">\n${[
    bundle.offers,
    bundle.finish,
    bundle.notifications,
    bundle.choices,
    bundle.draft,
    bundle.activity,
    bundle.script,
    bundle.componentJs,
  ].join("\n")}\n</script>`;
export async function assemble(
  data,
  { css = "", js = "", allowUnknownPages = false, bundle } = {},
) {
  // buildPage has already checked each page's HTML, and its script as written,
  // which arrives here encoded. The hub assembles a round from its stored pages
  // at each publish, so authoring: false keeps a page that an older pair build
  // checked from failing its round.
  const found = problems(data, "", { allowUnknownPages, authoring: false });
  if (found.length) throw new Error(found.join("\n"));
  const html = join(bundle || (await frameBundle()), data, css, js);
  readPlanData(html);
  return html;
}
// pair build measures a page's built file before it reports the page's problems,
// so joinPage() joins a page that assemble() would refuse.
export const joinPage = async (data, css, js) =>
  join(await frameBundle(), data, css, js);
export async function assembleHome(title) {
  return join(await frameBundle(), { title, pages: [] }, "", "");
}
function join(bundle, data, css, js) {
  const { shell, style, drawingEditor, componentCss } = bundle;
  // A bundle stored before the dialogs moved to a file of their own contains
  // them in its shell and has no dialogs field.
  return (
    shell
      .replace("<!-- DIALOGS -->", () => bundle.dialogs ?? "")
      .replace("<!-- DRAWING_EDITOR -->", () => scriptJson(drawingEditor))
      .replace(
        "<!-- FRAME_STYLE -->",
        // The cascade ranks an unlayered rule above every layered one, so the
        // frame's CSS goes in a layer of its own. A component rule then beats a
        // plan rule of any specificity, and a plan rule can still win with
        // !important.
        //
        // Page CSS is already scoped to its page, and nesting it inside the
        // component scope would exclude the scope's root itself.
        () =>
          `<style>\n@layer frame, plan, components;\n@layer frame {\n${style}\n}\n` +
          `@layer plan {\n${css}\n}\n@scope (#page-content) {\n@layer components {\n${componentCss}\n}\n}\n` +
          `</style>`,
      )
      .replace("<!-- FRAME_SCRIPT -->", () =>
        bundle.format === 2 ? moduleScript(bundle) : joinedScript(bundle),
      )
      // The plan's script is a module that runs after the frame's, so it can
      // use planUI and register a component of its own before the first page
      // renders.
      .replace(
        "<!-- CUSTOM_SCRIPT -->",
        () => `<script type="module">\n${js}\n</script>`,
      )
      .replace(jsonScript("plan-data"), () => jsonScriptTag("plan-data", data))
  );
}
// Rounds reuse page IDs, and the frame keeps several rounds loaded, so page CSS
// and scripts select the round as well as the page.
function pageScope(id, round) {
  return `#page-content[data-page-id="${id}"][data-round="${round}"]`;
}
export function pageStyles(pages, round) {
  return pages
    .filter((page) => page.cssText)
    .map((page) => `@scope (${pageScope(page.id, round)}) { ${page.cssText} }`)
    .join("\n");
}
export function pageScripts(pages, round) {
  return pages
    .filter((page) => page.jsText)
    .map((page) => {
      const encoded = Buffer.from(page.jsText).toString("base64");
      return `import("data:text/javascript;base64,${encoded}").then(({ setup }) => {
        if (typeof setup !== "function") throw new Error("Page ${page.id} must export setup");
        const run = ({ detail }) => {
          if (detail.page.id === ${JSON.stringify(page.id)} && detail.round === ${JSON.stringify(round)}) setup(detail.element, window.planUI);
        };
        window.addEventListener("plan:page", run);
        if (window.planUI?.page?.id === ${JSON.stringify(page.id)} && window.planUI?.round === ${JSON.stringify(round)})
          setup(document.getElementById("page-content"), window.planUI);
      }).catch((error) => console.error("Page ${page.id} script:", error));`;
    })
    .join("\n");
}
