import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
// Every module under src/frame/ by its #frame/ name, and each src/shared/
// module one of them imports by a #shared/ name.
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
// The frame's stylesheets in cascade order, which follows where each one's
// first rule sat in the single stylesheet they came from.
const stylesheets = [
  "app/tokens.css",
  "app/base.css",
  "app/shell.css",
  "pages/page-list.css",
  "pages/reading.css",
  "sync/activity.css",
  "review/review.css",
  "pages/agreed.css",
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
// The names component behaviors use without importing them. registry.mjs
// re-exports each one from the module that declares it.
const componentNames = [
  "$",
  "base",
  "color",
  "copyButton",
  "failed",
  "figure",
  "libraries",
  "linkButton",
  "online",
  "page",
  "pages",
  "plan",
  "readData",
  "script",
  "show",
  "syntaxThemes",
  "uuid",
];
// A module in a data: URL has no base URL, so the frame's modules import
// each other by #frame/… and #shared/… names, which the import map resolves.
function moduleScript({ modules, componentJs }) {
  const imports = {};
  for (const [name, text] of Object.entries(modules)) {
    const source = `${text}\n//# sourceURL=${name.slice(1)}\n`;
    imports[name] =
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  }
  return (
    `<script type="importmap">\n${JSON.stringify({ imports })}\n</script>\n` +
    `<script type="module">\n` +
    `import { ${componentNames.join(", ")} } from "#frame/app/registry.mjs";\n` +
    `import "#frame/app/boot.mjs";\n${componentJs}\n</script>`
  );
}
// A round keeps the bundle stored when its Agreed was published. A bundle
// with no format predates the split, and its files share one scope.
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
  const found = problems(data, js, { allowUnknownPages });
  if (found.length) throw new Error(found.join("\n"));
  bundle ||= await frameBundle();
  const { shell, style, drawingEditor, componentCss } = bundle;
  if (/<\/style/i.test(css) || /<\/script/i.test(js))
    throw new Error(
      "Custom CSS/JS cannot contain HTML closing style/script tags; escape the less-than character in strings.",
    );
  // A bundle stored before the dialogs had a file of their own carries them
  // in its shell.
  const html = shell
    .replace("<!-- DIALOGS -->", () => bundle.dialogs ?? "")
    .replace("<!-- DRAWING_EDITOR -->", () => scriptJson(drawingEditor))
    .replace(
      "<!-- FRAME_STYLE -->",
      // The cascade ranks an unlayered rule above every layered one, so the
      // frame takes a layer of its own rather than staying outside them. A
      // component rule then beats a plan rule of any specificity, and a plan
      // that means it can still say !important.
      // Page CSS arrives scoped to its page. Nesting it inside the component
      // scope would exclude the root itself.
      () =>
        `<style>\n@layer frame, plan, components;\n@layer frame {\n${style}\n}\n` +
        `@layer plan {\n${css}\n}\n@scope (#page-content) {\n@layer components {\n${componentCss}\n}\n}\n` +
        `</style>`,
    )
    .replace("<!-- FRAME_SCRIPT -->", () =>
      bundle.format === 2 ? moduleScript(bundle) : joinedScript(bundle),
    )
    // A module, and after the frame's, so the plan's own script sees planUI
    // and can register a component of its own before the first page renders.
    .replace(
      "<!-- CUSTOM_SCRIPT -->",
      () => `<script type="module">\n${js}\n</script>`,
    )
    .replace(jsonScript("plan-data"), () => jsonScriptTag("plan-data", data));
  readPlanData(html);
  return html;
}
// Rounds reuse page IDs, and the reader keeps several rounds loaded, so
// page CSS and scripts match the round as well as the page.
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
