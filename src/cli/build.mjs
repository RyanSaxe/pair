import fs from "node:fs/promises";
import path from "node:path";
import { assemble, pageScripts, pageStyles } from "../build/assemble.mjs";
import { fieldProblems } from "../build/fields.mjs";
import { sizeImages } from "../build/image-size.mjs";
import { problems } from "../build/lint.mjs";
import { pageData, pagePlan, validPage } from "../shared/records.mjs";
import { jsonScriptTag } from "../shared/util.mjs";

export async function buildPage(source, input) {
  const unknown = fieldProblems(input);
  if (unknown.length)
    throw new Error(
      unknown.map((line) => `${path.basename(source)}: ${line}`).join("\n"),
    );
  const read = (file) =>
    fs.readFile(path.resolve(path.dirname(source), file), "utf8");
  const { page: rawPage, ...outer } = input;
  if (!rawPage || typeof rawPage !== "object" || Array.isArray(rawPage))
    throw new Error("Page source requires one page object");
  if (rawPage.file && rawPage.html !== undefined)
    throw new Error("Use file or html for a page, not both");
  const page = { ...rawPage };
  if (page.file) page.html = await read(page.file);
  if (page.html) page.html = sizeImages(page.html);
  if (page.task?.html)
    page.task = { ...page.task, html: sizeImages(page.task.html) };
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
        const agreement = {
          ...entry,
          ...(file ? { html: await read(file) } : {}),
        };
        if (agreement.html) agreement.html = sizeImages(agreement.html);
        return agreement;
      }),
    );
  const record = validPage({ ...outer, page });
  const data = pagePlan(record);
  // assemble receives the page's script encoded, so it is checked here as
  // written.
  const authoredProblems = problems(data, page.jsText || "", {
    allowUnknownPages: true,
  });
  if (authoredProblems.length) throw new Error(authoredProblems.join("\n"));
  const preview = await assemble(data, {
    css: pageStyles([page], record.round),
    js: pageScripts([page], record.round),
    allowUnknownPages: true,
  });
  return preview.replace(
    "</body>",
    () => `${jsonScriptTag("page-data", record)}</body>`,
  );
}
export async function build(source) {
  return buildPage(source, JSON.parse(await fs.readFile(source, "utf8")));
}
// The next step names the source's directory as --source, and for Agreed
// the pages.json beside that directory, where guide/pages.md puts it.
export async function main({ args: [source, output] }) {
  const html = await build(path.resolve(source));
  await fs.writeFile(output, html, { flag: "wx", mode: 0o600 });
  const built = path.resolve(output);
  const directory = path.dirname(path.resolve(source));
  const pages =
    pageData(html).page.id === "agreed"
      ? ` --pages ${path.join(path.dirname(directory), "pages.json")}`
      : "";
  return {
    next: `Publish the page with pair publish --session-dir SESSION_DIR --file ${built} --source ${directory}${pages}`,
    data: `Built ${built}`,
    json: { output: built },
  };
}
