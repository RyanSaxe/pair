import fs from "node:fs/promises";
import { readPlanData } from "../shared/records.mjs";
import { jsonScript, jsonScriptTag, scriptJson } from "../shared/util.mjs";
import {
  componentBehaviors,
  componentRoots,
  componentStyles,
} from "./components.mjs";
import { problems } from "./lint.mjs";

const assets = new URL("../frame/", import.meta.url);
export async function frameBundle() {
  const [
    shell,
    style,
    script,
    notifications,
    choices,
    draft,
    activity,
    drawingEditor,
    offers,
    finish,
  ] = await Promise.all(
    [
      "frame.html",
      "frame.css",
      "frame.js",
      "notifications.mjs",
      "choices.mjs",
      "draft.mjs",
      "activity.mjs",
      "drawing-editor.html",
      "../shared/offers.mjs",
      "finish.mjs",
    ].map((name) => fs.readFile(new URL(name, assets), "utf8")),
  );
  const roots = componentRoots();
  const [componentCss, componentJs] = await Promise.all([
    componentStyles(roots),
    componentBehaviors(roots),
  ]);
  return {
    shell,
    style,
    script,
    notifications,
    choices,
    draft,
    activity,
    drawingEditor,
    offers,
    finish,
    componentCss,
    componentJs,
  };
}
export async function assemble(
  data,
  { css = "", js = "", allowUnknownPages = false, bundle } = {},
) {
  const found = problems(data, js, { allowUnknownPages });
  if (found.length) throw new Error(found.join("\n"));
  const {
    shell,
    style,
    script,
    notifications,
    choices,
    draft,
    activity,
    drawingEditor,
    offers,
    finish,
    componentCss,
    componentJs,
  } = bundle || (await frameBundle());
  if (/<\/style/i.test(css) || /<\/script/i.test(js))
    throw new Error(
      "Custom CSS/JS cannot contain HTML closing style/script tags; escape the less-than character in strings.",
    );
  const html = shell
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
    .replace(
      "<!-- FRAME_SCRIPT -->",
      () =>
        `<script type="module">\n${offers}\n${finish}\n${notifications}\n${choices}\n${draft}\n${activity}\n${script}\n${componentJs}\n</script>`,
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
