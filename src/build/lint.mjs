import { readFileSync } from "node:fs";

const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`));
  return match ? (match[1] ?? match[2]) : undefined;
};
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
/** Structural problems in the assembled pages and the plan's script. */
export function problems(data, js = "", { allowUnknownPages = false } = {}) {
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
    const tags = html.match(/<[a-zA-Z][^>]*>/g) || [];
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
        label !== undefined &&
        attribute(tag, "data-value") !== undefined &&
        label.length > labelLimit
      )
        list.push(
          `${at}: option label "${label}" is ${label.length} characters, over ${labelLimit}`,
        );
      // The frame draws the page title as the page's only h1, so a second
      // one is always a duplicate heading, whatever it says.
      if (/^<h1[\s>]/i.test(tag))
        list.push(`${at}: the frame draws the page title, so a page has no h1`);
      if (/^<pre\b/i.test(tag) || /^<div\b/i.test(tag)) {
        const named = attribute(tag, "data-file") !== undefined;
        const source = attribute(tag, "data-diff-source") !== undefined;
        if (
          (/^<pre\b/i.test(tag) || named) &&
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
      const link = attribute(tag, "href");
      if (
        link?.startsWith("#") &&
        !targets.has(link.slice(1)) &&
        !allowUnknownPages
      )
        if (!new RegExp(`\\sid="${link.slice(1)}"`).test(html))
          list.push(`${at}: link "${link}" names no page`);
      const prototype = attribute(tag, "data-prototype");
      if (prototype !== undefined && !prototypes.has(prototype))
        list.push(`${at}: prototype "${prototype}" does not exist`);
    }
    // Each control's options run from its tag to the next control's tag.
    const parts = html.split(
      /(?=<[a-zA-Z][^>]*\sdata-(?:choice|multiselect|question|drawing-question)=)/,
    );
    for (const part of parts) {
      const tag = part.match(/^<[a-zA-Z][^>]*>/)?.[0];
      if (!tag) continue;
      const kind = controlKinds.find(
        (name) => attribute(tag, name) !== undefined,
      );
      const id = attribute(tag, kind);
      const options =
        part.match(/<[a-zA-Z][^>]*\sdata-value(?:=|\s|>)[^>]*>/g) || [];
      for (const option of options)
        if (!attribute(option, "data-value"))
          list.push(`${at}: an option in "${id}" has no data-value`);
      if (kind === "data-choice" && options.length < 2)
        list.push(
          `${at}: decision "${id}" has ${options.length} option${options.length === 1 ? "" : "s"}`,
        );
      if (kind === "data-question" && !/<textarea\b/i.test(part))
        list.push(`${at}: question "${id}" has no textarea`);
      // A box the author checked would read as the reviewer's choice.
      if (
        kind === "data-multiselect" &&
        (part.match(/<input\b[^>]*>/gi) || []).some((input) =>
          /\schecked(?=[\s=/>])/i.test(input),
        )
      )
        list.push(
          `${at}: checklist "${id}" has a checked box. Start every box unchecked.`,
        );
    }
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
    if (hit) list.push(`plan.js line ${index + 1} restyles document.${hit[1]}`);
  });
  return list;
}
