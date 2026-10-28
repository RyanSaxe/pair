import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { lineRanges } from "../shared/lines.mjs";

/* A comment, or a start or end tag. A tag runs to the first ">" outside a
   quoted value, as it does in the browser, so a ">" in an attribute such
   as data-label="a -> b" stays in its tag. A comment that never closes
   runs to the end. */
const token =
  /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const attributePattern =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
/** A start tag's lowercase name and its attributes. An attribute written
 * with no value is present and has the value undefined, and the browser
 * keeps the first of two with one name. */
function readTag(name, text) {
  const attributes = new Map();
  for (const [, key, ...values] of text.matchAll(attributePattern))
    if (!attributes.has(key.toLowerCase()))
      attributes.set(
        key.toLowerCase(),
        values.find((value) => value !== undefined),
      );
  return { name: name.toLowerCase(), attributes };
}
const code = (tag) =>
  tag.attributes.has("data-language") || tag.attributes.has("data-diagram");
// The browser reads no tags inside these.
const textElements = new Set(["textarea", "script", "style"]);
/** The page's start and end tags in source order, without the comments,
 * which the browser does not show. An end tag has end set. A code block, a
 * diagram, a textarea, a script and a style hold text, so each one's text,
 * up to its end tag, is its body, and body is the offset where it starts. */
function pageTags(html) {
  const lower = html.toLowerCase();
  const pattern = new RegExp(token.source, "g");
  const tags = [];
  for (let match; (match = pattern.exec(html));) {
    const [, end, name, text] = match;
    if (!name) continue;
    if (end) {
      tags.push({ name: name.toLowerCase(), end: true });
      continue;
    }
    const tag = readTag(name, text);
    tags.push(tag);
    if (!code(tag) && !textElements.has(tag.name)) continue;
    const close = lower.indexOf(`</${tag.name}`, pattern.lastIndex);
    const to = close < 0 ? html.length : close;
    tag.at = pattern.lastIndex;
    tag.body = html.slice(tag.at, to);
    pattern.lastIndex = to;
  }
  return tags;
}
const startTags = (html) => pageTags(html).filter((tag) => !tag.end);
const attribute = (tag, name) => tag.attributes.get(name);
const controlKinds = [
  "data-choice",
  "data-multiselect",
  "data-question",
  "data-drawing-question",
];
const labelLimit = 24;
/* The language IDs the frame's pinned Shiki highlights. A name it does not
   know renders as an error under an uncoloured block, so the build refuses
   it. Regenerate the file from Shiki's bundledLanguages, plus its plain-text
   names, whenever the frame's Shiki version changes. */
const shiki = JSON.parse(
  readFileSync(new URL("shiki-languages.json", import.meta.url), "utf8"),
);
const shikiLanguages = new Set(shiki.languages);
function closestLanguage(name) {
  const lower = name.toLowerCase();
  if (shikiLanguages.has(lower)) return lower;
  return shiki.languages
    .filter(
      (id) => id.length > 1 && (lower.startsWith(id) || id.startsWith(lower)),
    )
    .sort((a, b) => b.length - a.length)[0];
}
/* The lines the frame renders from a code block's source. The HTML parser
   drops a newline right after <pre>, and the frame trims one more newline
   at each end before Shiki splits the lines. */
const renderedLines = (name, source) =>
  source
    .replace(name.toLowerCase() === "pre" ? /^\n{1,2}/ : /^\n/, "")
    .replace(/\n[ \t]*$/, "")
    .split("\n").length;
// "a", "a and b", "a, b and c".
const listing = (items) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
/* The browser reads a "<" before a letter, "/", "!" or "?" as the start of
   a tag or a comment, and then leaves that text out of the block, or puts
   the rest of the page inside it. */
const tagStart = /<[a-zA-Z/!?]/g;
const lineAt = (html, offset) => html.slice(0, offset).split("\n").length;
function codeProblems(tag, html, at) {
  const list = [];
  const starts = [...tag.body.matchAll(tagStart)].map(({ index }) => index);
  if (starts.length) {
    const lines = [
      ...new Set(starts.map((index) => lineAt(html, tag.at + index))),
    ];
    const language = attribute(tag, "data-language");
    const file = attribute(tag, "data-file");
    const block = tag.attributes.has("data-diagram")
      ? "the diagram"
      : `the ${language ? `${language} ` : ""}code block${file ? ` "${file}"` : ""}`;
    const sample = tag.body.slice(starts[0]).split("\n")[0].slice(0, 12);
    list.push(
      `${at}: ${block} has a < that the browser reads as a tag on line${lines.length === 1 ? "" : "s"} ${listing(lines)} of the page's HTML, first at "${sample}". Write &lt; for each < in a code block or a diagram.`,
    );
  }
  if (!tag.attributes.has("data-lines")) return list;
  const value = attribute(tag, "data-lines") ?? "";
  const ranges = lineRanges(value);
  if (!ranges)
    return [
      ...list,
      `${at}: data-lines "${value}" is not a list of lines. Write lines and ranges counted from 1, such as "7", "3-4" or "3-4, 9".`,
    ];
  // Line numbers count from the block's first line, so a line past its end
  // is usually the file's own line number.
  const last = Math.max(...ranges.map(([, to]) => to));
  const count = renderedLines(tag.name, tag.body);
  if (last > count)
    list.push(
      `${at}: data-lines "${value}" names line ${last}, and the block has ${count} line${count === 1 ? "" : "s"}. Count from the block's first line, and put the file's line numbers in data-caption.`,
    );
  return list;
}
/** The problems in each control's options. An option belongs to the
 * nearest control around it, which is the one the frame finds with
 * closest(). A control's element ends at the end tag that balances its own
 * start tag. */
function controlProblems(all, at) {
  const list = [];
  const groups = [];
  const open = [];
  for (const tag of all) {
    for (const group of open)
      if (group.name === tag.name) group.depth += tag.end ? -1 : 1;
    if (tag.end) {
      open.splice(0, open.length, ...open.filter((group) => group.depth));
      continue;
    }
    const kind = controlKinds.find(
      (name) => attribute(tag, name) !== undefined,
    );
    if (!kind) {
      open.at(-1)?.tags.push(tag);
      continue;
    }
    const group = {
      kind,
      id: attribute(tag, kind),
      name: tag.name,
      depth: 1,
      tags: [],
    };
    groups.push(group);
    open.push(group);
  }
  for (const { kind, id, tags: inside } of groups) {
    const options = inside.filter((tag) => tag.attributes.has("data-value"));
    for (const option of options)
      if (!attribute(option, "data-value"))
        list.push(`${at}: an option in "${id}" has no data-value`);
    // The frame marks each option whose value equals the reviewer's choice
    // as selected, so two options with one value are selected together.
    const values = options
      .map((option) => attribute(option, "data-value"))
      .filter(Boolean);
    for (const value of new Set(
      values.filter((value, index) => values.indexOf(value) !== index),
    ))
      list.push(
        `${at}: options in "${id}" share data-value "${value}". Give each option in a group its own data-value.`,
      );
    if (kind === "data-choice" && options.length < 2)
      list.push(
        `${at}: decision "${id}" has ${options.length} option${options.length === 1 ? "" : "s"}. Give it at least two.`,
      );
    if (
      kind === "data-question" &&
      !inside.some((tag) => tag.name === "textarea")
    )
      list.push(`${at}: question "${id}" has no textarea`);
    // A box the author checked would read as the reviewer's choice.
    if (
      kind === "data-multiselect" &&
      inside.some(
        (tag) => tag.name === "input" && tag.attributes.has("checked"),
      )
    )
      list.push(
        `${at}: checklist "${id}" has a checked box. Start every box unchecked.`,
      );
  }
  return list;
}
/** A "#" link names a page of the round, Agreed, Feedback, or an element
 * on its own page. */
export function linkProblems(html, at, targets) {
  const tags = startTags(html);
  const ids = new Set(tags.map((tag) => attribute(tag, "id")));
  const pages = [
    "agreed",
    ...[...targets].filter((id) => !["agreed", "feedback"].includes(id)),
  ];
  return tags
    .map((tag) => attribute(tag, "href"))
    .filter(
      (link) =>
        link?.startsWith("#") &&
        !targets.has(link.slice(1)) &&
        !ids.has(link.slice(1)),
    )
    .map(
      (link) =>
        `${at}: link "${link}" names no page of the round and no element on this page. The round's pages are ${listing(pages)}.`,
    );
}
/** Structural problems in the assembled pages and a page's own script.
 * With authoring false, it leaves out the rules that were added or changed
 * after an older pair build checked a stored page, so that page is never
 * held to them: the bare < in code, the option label limit, the checks on
 * each control's options, and data-lines. */
export function problems(
  data,
  js = "",
  { allowUnknownPages = false, authoring = true } = {},
) {
  const list = [];
  const pageIds = new Set();
  for (const page of data.pages) {
    if (pageIds.has(page.id)) list.push(`page "${page.id}" appears twice`);
    pageIds.add(page.id);
  }
  const targets = new Set([...pageIds, "agreed", "feedback"]);
  const prototypes = new Set((data.prototypes || []).map((item) => item.id));
  for (const page of data.pages) {
    const html = page.html || "";
    const at = `page "${page.id}"`;
    const all = pageTags(html);
    const tags = all.filter((tag) => !tag.end);
    const controls = new Set();
    for (const tag of tags) {
      for (const kind of controlKinds) {
        const id = attribute(tag, kind);
        if (id === undefined) continue;
        if (controls.has(id)) list.push(`${at}: control "${id}" appears twice`);
        controls.add(id);
        if (!attribute(tag, "data-label"))
          list.push(`${at}: control "${id}" has no data-label`);
      }
      // The tab strip shares its width between the option labels, so a long
      // one leaves nothing for the rest. Only the label a tab shows is
      // bounded; the option's own header keeps its wording, and a group's
      // label is read on Agreed and on Feedback, never in a strip.
      const label = attribute(tag, "data-label");
      if (
        authoring &&
        label !== undefined &&
        attribute(tag, "data-value") !== undefined &&
        label.length > labelLimit
      )
        list.push(
          `${at}: option label "${label}" is ${label.length} characters, over ${labelLimit}`,
        );
      // The frame draws the page title as the page's only h1, so a second
      // one is always a duplicate heading, whatever it says.
      if (tag.name === "h1")
        list.push(
          `${at}: remove the h1, because the frame shows the page title as the page's only h1. Start headings at h2.`,
        );
      if (tag.name === "pre" || tag.name === "div") {
        const named = attribute(tag, "data-file") !== undefined;
        const source = attribute(tag, "data-diff-source") !== undefined;
        if (
          (tag.name === "pre" || named) &&
          !source &&
          !attribute(tag, "data-language")
        )
          list.push(`${at}: a code block has no data-language`);
        // before-after shows both sides in the Pierre viewer. A code block
        // marked as a diff shows neither.
        if (/^(?:diff|patch)$/i.test(attribute(tag, "data-language") || ""))
          list.push(
            `${at}: a code block marked diff belongs in before-after. Run pair diff BEFORE AFTER OUT.json`,
          );
      }
      const language = attribute(tag, "data-language");
      if (language && !shikiLanguages.has(language)) {
        const closest = closestLanguage(language);
        list.push(
          `${at}: data-language "${language}" is not a language Shiki highlights. ${closest ? `Did you mean "${closest}"?` : "Use a Shiki language ID, such as ts, python, shell or text."}`,
        );
      }
      const prototype = attribute(tag, "data-prototype");
      if (prototype !== undefined && !prototypes.has(prototype))
        list.push(`${at}: prototype "${prototype}" does not exist`);
      if (authoring && code(tag)) list.push(...codeProblems(tag, html, at));
    }
    if (!allowUnknownPages) list.push(...linkProblems(html, at, targets));
    if (authoring) list.push(...controlProblems(all, at));
    for (const input of html.match(
      /<textarea[^>]*\sdata-diff-input[^>]*>([\s\S]*?)<\/textarea>/gi,
    ) || []) {
      const text = input
        .replace(/^<textarea[^>]*>/i, "")
        .replace(/<\/textarea>$/i, "");
      let parsed;
      try {
        parsed = JSON.parse(
          text
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&"),
        );
      } catch {}
      if (
        !["before", "after", "patch"].every(
          (key) => typeof parsed?.[key] === "string",
        )
      )
        list.push(
          `${at}: a diff input is not JSON with before, after and patch`,
        );
    }
  }
  // Reading the body's width is fine; writing to the frame's root elements
  // restyles the whole app.
  const mutation =
    /document\.(body|documentElement)\.(style|className|classList|dataset|innerHTML|setAttribute|append|prepend|insertAdjacent|replaceChildren|remove)\b/;
  js.split("\n").forEach((line, index) => {
    const hit = line.match(mutation);
    if (hit) list.push(`page.js line ${index + 1} restyles document.${hit[1]}`);
  });
  if (js) list.push(...syntaxProblems(js));
  return list;
}
/* The frame imports a page's script as a module, and one that does not
   parse leaves the page with no behavior and an error only in the console.
   node --check parses the script as a module without running it. */
function syntaxProblems(js) {
  try {
    execFileSync(process.execPath, ["--check", "--input-type=module", "-"], {
      input: js,
      stdio: ["pipe", "ignore", "pipe"],
      timeout: 20_000,
    });
    return [];
  } catch (error) {
    const output = String(error.stderr || "");
    const line = output.match(/^\[stdin\]:(\d+)/m)?.[1];
    const reason = output.match(/^SyntaxError: .*$/m)?.[0];
    if (!reason) throw error;
    return [`page.js line ${line} does not parse: ${reason}`];
  }
}
