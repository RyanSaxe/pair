import fs from "node:fs/promises";
import path from "node:path";
import { joinPage, pageScripts, pageStyles } from "../build/assemble.mjs";
import { fieldProblems } from "../build/fields.mjs";
import { sizeImages } from "../build/image-size.mjs";
import { problems } from "../build/lint.mjs";
import {
  pageData,
  pagePlan,
  readPlanData,
  validPage,
} from "../shared/records.mjs";
import { jsonScriptTag } from "../shared/util.mjs";
import { refuseOverwrite, tooBigToPublish } from "./output.mjs";

// A diff's textarea either has data-diff-input set to the JSON file that pair
// diff wrote, as data-diff-input="retry.json", or contains that JSON pasted in
// and escaped by hand. The build writes the named file's JSON into the textarea
// escaped, so the browser reads the file's text as it is.
const TEXTAREA = /(<textarea\b[^>]*>)([\s\S]*?)<\/textarea>/gi;
const DIFF_FILE = /\sdata-diff-input\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const diffFile = (open) => {
  const match = DIFF_FILE.exec(open);
  return match ? (match[1] ?? match[2] ?? match[3]) : "";
};
async function readDiffInput(directory, name) {
  const file = path.resolve(directory, name);
  const refuse = (problem) =>
    new Error(`data-diff-input names ${name}, and ${file} ${problem}`);
  const text = await fs.readFile(file, "utf8").catch(() => {
    throw refuse(
      `cannot be read. Write it with pair diff BEFORE AFTER ${file}`,
    );
  });
  let input;
  try {
    input = JSON.parse(text);
  } catch {}
  if (
    !["before", "after", "patch"].every(
      (key) => typeof input?.[key] === "string",
    )
  )
    throw refuse(
      "is not JSON with before, after and patch strings. Name a file that pair diff BEFORE AFTER OUT.json wrote",
    );
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
async function diffInputs(html, directory) {
  const inputs = new Map();
  for (const [, open, pasted] of html.matchAll(TEXTAREA)) {
    const name = diffFile(open);
    if (!name) continue;
    if (pasted.trim())
      throw new Error(
        `data-diff-input names ${name}, and the textarea is not empty. Leave it empty.`,
      );
    inputs.set(name, await readDiffInput(directory, name));
  }
  return html.replace(TEXTAREA, (whole, open) => {
    const name = diffFile(open);
    return name ? `${open}${inputs.get(name)}</textarea>` : whole;
  });
}

export async function buildPage(source, input) {
  const unknown = fieldProblems(input);
  if (unknown.length)
    throw new Error(
      unknown.map((line) => `${path.basename(source)}: ${line}`).join("\n"),
    );
  const directory = path.dirname(source);
  const read = (file) => fs.readFile(path.resolve(directory, file), "utf8");
  // The build lists a css or js file that cannot be read with the page's other
  // problems, so one build reports them all.
  const unreadable = [];
  const readNamed = (field) =>
    read(rawPage[field]).catch(() => {
      unreadable.push(
        `page "${rawPage.id}": ${field} names ${rawPage[field]}, and pair build cannot read ${path.resolve(directory, rawPage[field])}. Write that file, or correct the path in ${field}.`,
      );
      return "";
    });
  const prepare = (html) => diffInputs(sizeImages(html), directory);
  const { page: rawPage, ...outer } = input;
  if (!rawPage || typeof rawPage !== "object" || Array.isArray(rawPage))
    throw new Error("Page source requires one page object");
  if (rawPage.file && rawPage.html !== undefined)
    throw new Error("Use file or html for a page, not both");
  const page = { ...rawPage };
  if (page.file) page.html = await read(page.file);
  if (page.html) page.html = await prepare(page.html);
  if (page.task?.html)
    page.task = { ...page.task, html: await prepare(page.task.html) };
  delete page.file;
  if (page.css) page.cssText = await readNamed("css");
  if (page.js) page.jsText = await readNamed("js");
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
        if (agreement.html) agreement.html = await prepare(agreement.html);
        return agreement;
      }),
    );
  const record = validPage({ ...outer, page });
  const data = pagePlan(record);
  const preview = await joinPage(
    data,
    pageStyles([page], record.round),
    pageScripts([page], record.round),
  );
  const html = preview.replace(
    "</body>",
    () => `${jsonScriptTag("page-data", record)}</body>`,
  );
  // The built file contains the page's script encoded, so the build checks the
  // script here as written.
  const found = [
    ...unreadable,
    ...problems(data, page.jsText || "", { allowUnknownPages: true }),
    ...tooBigToPublish(`page "${page.id}"`, { action: "publish", html }),
  ];
  if (found.length) throw new Error(found.join("\n"));
  readPlanData(html);
  return html;
}
export async function build(source) {
  return buildPage(source, JSON.parse(await fs.readFile(source, "utf8")));
}
// For Agreed, main() adds --pages to the next step, with the pages.json in the
// parent of the source's directory, the path that guide/pages.md gives.
export async function main({ args: [source, output] }) {
  const html = await build(path.resolve(source));
  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await fs
    .writeFile(output, html, { flag: "wx", mode: 0o600 })
    .catch(refuseOverwrite(output));
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
