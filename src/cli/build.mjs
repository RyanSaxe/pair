import fs from "node:fs/promises";
import path from "node:path";
import { assemble, pageScope, pageScripts } from "../build/assemble.mjs";
import { problems } from "../build/lint.mjs";
import { pagePlan, validPage } from "../shared/records.mjs";

export async function buildPage(source, input) {
  const read = (file) =>
    fs.readFile(path.resolve(path.dirname(source), file), "utf8");
  const { page: rawPage, ...outer } = input;
  if (!rawPage || typeof rawPage !== "object" || Array.isArray(rawPage))
    throw new Error("Page source requires one page object");
  if (rawPage.file && rawPage.html !== undefined)
    throw new Error("Use file or html for a page, not both");
  const page = { ...rawPage };
  if (page.file) page.html = await read(page.file);
  delete page.file;
  if (page.css) page.cssText = await read(page.css);
  if (page.js) page.jsText = await read(page.js);
  delete page.css;
  delete page.js;
  if (page.prototypes)
    page.prototypes = await Promise.all(
      page.prototypes.map(async ({ file, ...prototype }) => {
        if (file && prototype.html !== undefined)
          throw new Error("Use file or html for a prototype, not both");
        return { ...prototype, ...(file ? { html: await read(file) } : {}) };
      }),
    );
  if (page.agreements)
    page.agreements = await Promise.all(
      page.agreements.map(async ({ file, ...entry }) => {
        if (file && entry.html !== undefined)
          throw new Error("Use file or html for an agreement, not both");
        return { ...entry, ...(file ? { html: await read(file) } : {}) };
      }),
    );
  const record = validPage({ ...outer, page });
  const data = pagePlan(record);
  const css = page.cssText
    ? `@scope (${pageScope(page.id, record.round)}) { ${page.cssText} }`
    : "";
  // assemble checks the script the frame runs, which carries the page's own
  // script encoded, so the page's script is checked here as written.
  const authoredProblems = problems(data, page.jsText || "", {
    allowUnknownPages: true,
  });
  if (authoredProblems.length) throw new Error(authoredProblems.join("\n"));
  const preview = await assemble(data, {
    css,
    js: pageScripts([page], record.round),
    allowUnknownPages: true,
  });
  return preview.replace(
    "</body>",
    () =>
      `<script type="application/json" id="page-data">${JSON.stringify(record).replaceAll("<", "\\u003c")}</script></body>`,
  );
}
export async function build(source) {
  return buildPage(source, JSON.parse(await fs.readFile(source, "utf8")));
}
export async function main([source, output, ...extra]) {
  if (!source || !output || extra.length)
    throw new Error("Usage: pair build SOURCE.json OUTPUT.html");
  const html = await build(path.resolve(source));
  await fs.writeFile(output, html, { flag: "wx", mode: 0o600 });
  console.log(path.resolve(output));
}
