import { loadedStatus } from "../session/proposal-status.mjs";
import { decode, parse, textOf } from "./html.mjs";

/* Each function here turns one record from a session's files into search
   documents. A document has its kind, one of the modal's six, and the type
   the matcher ranks by, and it names where it lives: round, page, block and
   item.

   One rule reads every block of a page, so a component needs no code here. A
   block's text is what a reader sees: its text nodes and the attributes the
   frame draws. Its attrs are the words of its other attributes, which rank below
   its text, so a custom component's words stay findable. It knows three things
   about pair's components: a diff keeps its patch as JSON in a textarea beside
   the viewer's own controls, a prototype's HTML reads as its text, and a visual
   option draws its data-label. */

// An attribute named here holds no words a reader would search for. It sets how
// an element behaves or looks, or it holds an ID that a component reads.
const NOT_TEXT = new Set(
  `id class style src href target rel type width height role hidden lang charset
   preload poster loading controls muted loop autoplay playsinline tabindex rows
   cols colspan rowspan scope for disabled readonly checked selected min max step
   start data-kind data-state data-choice data-multiselect data-question
   data-drawing-question data-value data-proposal data-line data-lines
   data-proposed-lines data-math`.split(/\s+/),
);
// The frame draws these on the page, so their words are the block's text.
const DRAWN = new Set([
  "data-title",
  "data-caption",
  "data-file",
  "data-notes",
  "data-terms",
]);
// A hand-written script holds the words it draws. A bundled library is mostly
// someone else's code, so a script over this size is left out.
const SCRIPT_LIMIT = 32_000;
const LONG_TOKEN = /\S{513,}/g;
const DATA_URL = /data:[^\s"')]+/g;

const flat = (text) => (text || "").replace(/\s+/g, " ").trim();
const clean = (text) =>
  flat((text || "").replace(DATA_URL, " ").replace(LONG_TOKEN, " "));
const isHeading = (tag) => /^h[1-6]$/.test(tag ?? "");

const prototypeText = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<script[\s\S]*?<\/script>/g, (script) =>
      script.length > SCRIPT_LIMIT ? " " : script,
    );

const strings = (value) =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value).flatMap(strings)
      : [];

// A component can keep words in an attribute as JSON, such as a code block's
// line notes. Its strings are the words, and its keys and syntax are not.
function attributeWords(value) {
  if (value[0] !== "[" && value[0] !== "{") return value;
  try {
    return strings(JSON.parse(value)).join(" ");
  } catch {
    return value;
  }
}

// A visual option's label is drawn on its tab, and most options repeat it in
// their own words.
const drawnLabel = (node, name, value) =>
  name === "data-label" &&
  node.tag === "article" &&
  !textOf(node).toLowerCase().includes(value.toLowerCase());

function textareaWords(node) {
  const raw = decode(node.raw ?? "");
  try {
    return JSON.parse(raw).patch ?? "";
  } catch {
    return raw;
  }
}

function collect(node, page, words, inSvg = false) {
  if (node.text !== undefined) {
    words.text.push(node.text);
    return words;
  }
  const svg = inSvg || node.tag === "svg";
  const diff = (node.children ?? []).find(
    (child) => child.tag === "textarea" && "data-diff-input" in child.attrs,
  );
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if (svg || !value || value.startsWith("data:") || NOT_TEXT.has(name))
      continue;
    if (name.startsWith("aria-") && name !== "aria-label") continue;
    if (name === "data-prototype") {
      const prototype = (page.prototypes ?? []).find((p) => p.id === value);
      if (prototype) {
        words.text.push(prototype.title ?? "", prototype.description ?? "");
        collect(parse(prototypeText(prototype.html ?? "")), page, words);
      }
    } else if (DRAWN.has(name) || drawnLabel(node, name, value))
      words.text.push(attributeWords(value));
    else if (!diff) words.attrs.push(attributeWords(value));
  }
  if (diff) {
    words.text.push(textareaWords(diff));
    return words;
  }
  if (node.tag === "style" || node.tag === "template") return words;
  if (node.tag === "textarea") {
    words.text.push(textareaWords(node));
    return words;
  }
  // Only a script is left with raw text, and a reader never sees it.
  if (node.raw) words.attrs.push(node.raw);
  for (const child of node.children ?? []) collect(child, page, words, svg);
  return words;
}

const blockId = (node, topic, index) =>
  node.attrs.id || `block-${topic}-${index}`;

// A row shows a code icon for a block that is mostly code, and nothing else
// reads this.
function holdsCode(node) {
  const attrs = node.attrs ?? {};
  if (
    node.tag === "pre" ||
    "data-language" in attrs ||
    "data-diff-input" in attrs ||
    "data-diagram" in attrs
  )
    return true;
  return (node.children ?? []).some(
    (child) => child.text === undefined && holdsCode(child),
  );
}

// The frame numbers a page's top-level elements, so a document's block is its
// position among them. Top-level text belongs to no block.
export function pageDocs(page, round, at, tree = parse(page.html ?? "")) {
  const docs = [];
  const base = {
    kind: "pages",
    type: "page block",
    round,
    page: page.id,
    item: null,
    at,
  };
  let heading = "";
  let index = -1;
  for (const child of tree.children) {
    if (child.text !== undefined) {
      const text = clean(child.text);
      if (text) docs.push({ ...base, block: null, heading, text });
      continue;
    }
    index++;
    if (child.tag === "style") continue;
    const words = collect(child, page, { text: [], attrs: [] });
    const text = clean(words.text.join(" "));
    const attrs = clean(words.attrs.join(" "));
    if (isHeading(child.tag)) heading = text;
    if (text || attrs)
      docs.push({
        ...base,
        block: index,
        blockId: blockId(child, page.id, index),
        heading,
        text,
        ...(attrs ? { attrs } : {}),
        ...(holdsCode(child) ? { code: true } : {}),
      });
  }
  return docs;
}

/* A thread names the element it was written on, which can be a block or anything
   inside one, so the store keeps which block holds each ID on a page. tops is
   each top-level element's DOM ID, in the frame's numbering. inner is the block
   that holds every other ID, including the IDs pageTargets in the frame gives a
   control that has none. */
function pageBlocks(page, round, tree) {
  const tops = [];
  const inner = {};
  const controls = { choice: 0, multiselect: 0, question: 0 };
  const visit = (node, block) => {
    if (node.text !== undefined || node.tag === "template") return;
    const { id } = node.attrs;
    if (id) inner[id] ??= block;
    for (const type of Object.keys(controls))
      if (`data-${type}` in node.attrs) {
        const count = controls[type]++;
        if (!id) inner[`${type}-${page.id}-${count}`] ??= block;
      }
    for (const child of node.children ?? []) visit(child, block);
  };
  for (const child of tree.children) {
    if (child.text !== undefined) continue;
    visit(child, tops.length);
    tops.push(blockId(child, page.id, tops.length));
  }
  return { round, page: page.id, tops, inner };
}

export function readPage(page, round, at) {
  const tree = parse(page.html ?? "");
  return {
    docs: pageDocs(page, round, at, tree),
    blocks: pageBlocks(page, round, tree),
  };
}

// A page title draws the first block of its page, and a thread draws the block
// that holds its target. Only the page's own file says which block that is, so
// the store places these two once it has every file.
export function placed(doc, pages) {
  if (doc.kind !== "threads" && doc.type !== "page title") return doc;
  const blocks = pages.get(`${doc.round}/${doc.page}`);
  if (!blocks) return doc;
  const { tops, inner } = blocks;
  if (doc.type === "page title") return { ...doc, blockId: tops[0] ?? null };
  const top = tops.indexOf(doc.target);
  const block =
    top >= 0
      ? top
      : Object.hasOwn(inner, doc.target)
        ? inner[doc.target]
        : null;
  return block === null ? doc : { ...doc, block, blockId: tops[block] };
}

export function agreedDocs(page, round, at) {
  const base = { kind: "agreed", round, page: "agreed", block: null, at };
  const docs = [];
  if (page.task)
    docs.push({
      ...base,
      type: "task",
      item: null,
      heading: page.task.title || "",
      text: clean(textOf(parse(page.task.html || ""))),
    });
  for (const entry of page.agreements ?? [])
    docs.push({
      ...base,
      type: "alignment",
      item: entry.id,
      heading: entry.title || "",
      text: clean(textOf(parse(entry.html || ""))),
    });
  return docs;
}

export function threadDocs(thread) {
  const docs = [];
  (thread.messages ?? []).forEach((message, index) => {
    const text = clean(
      typeof message.text === "string"
        ? message.text
        : textOf(parse(message.html ?? "")),
    );
    if (!text) return;
    docs.push({
      kind: "threads",
      type: "thread message",
      round: thread.round ?? null,
      page: thread.proposal ? "work" : (thread.topic ?? null),
      block: null,
      target: thread.target ?? null,
      item: `${thread.id}/${index}`,
      // Every thread on Agreed has the same page, so its anchor names its card.
      heading:
        (thread.topic === "agreed" && thread.anchor) ||
        thread.page ||
        thread.anchor ||
        "",
      text,
      from: message.from,
      at: Date.parse(message.at) || 0,
    });
  });
  return docs;
}

export function feedbackDocs(event) {
  const payload = event.payload ?? {};
  const groups = payload.groups ?? {};
  const at = Date.parse(event.receivedAt) || 0;
  const docs = [];
  const add = (kind, type, round, page, item, heading, text) => {
    const words = clean(text);
    if (words)
      docs.push({
        kind,
        type,
        round: round ?? payload.round ?? null,
        page: page ?? null,
        block: null,
        item,
        heading,
        text: words,
        from: "reviewer",
        at,
      });
  };
  // A Start's message shows on its card, which proposalDocs() reads, and never
  // on the round's Review page.
  if (payload.intent !== "start")
    add(
      "notes",
      "send message",
      payload.round,
      "feedback",
      payload.id,
      `Round ${payload.round} message`,
      payload.message,
    );
  if (payload.intent && payload.intent !== "feedback-only")
    add(
      "notes",
      "send message",
      payload.round,
      "work",
      payload.proposal ?? payload.id,
      payload.proposal ?? "",
      payload.guidance,
    );
  for (const note of groups.notes ?? [])
    add(
      "notes",
      "note",
      note?.round,
      note?.topic,
      note?.id,
      note?.anchor ?? "",
      note?.text,
    );
  for (const [key, answer] of Object.entries(groups.answers ?? {}))
    add(
      "answers",
      "typed answer",
      answer?.round,
      answer?.topic,
      key,
      answer?.label ?? "",
      answer?.kind === "drawing" ? answer.label : answer?.text,
    );
  for (const [key, choice] of Object.entries(groups.choices ?? {}))
    add(
      "answers",
      "chosen option",
      choice?.round,
      choice?.topic,
      key,
      choice?.label ?? "",
      chosen(choice),
    );
  return docs;
}

function chosen(choice) {
  if (choice?.kind === "multiple")
    return (choice.options ?? [])
      .filter((option) => option?.checked)
      .map((option) => option.label)
      .join(", ");
  return String(choice?.valueLabel ?? choice?.value ?? "");
}

/* A card's text is the words the frame's cardElement() draws from this record.
   It leaves out the links that name a page or another card, because a search on
   that name finds the page or card under its own title, and every card from a
   page would otherwise rank above that page's own blocks. */
export function proposalDocs(proposal) {
  const { started, status, withdrawn, done } = proposal;
  const parts = status
    ? loadedStatus(status).parts.map(({ text }) => text)
    : [];
  const text = clean(
    [
      proposal.title,
      proposal.delivers,
      ...parts,
      started?.quote ?? started?.message,
      withdrawn?.reason,
      done?.where,
    ]
      .filter(Boolean)
      .join(". ")
      // A field can end in its own mark, and a row shouldn't show "swim.. Can".
      .replace(/([.!?])\. /g, "$1 "),
  );
  if (!text) return [];
  return [
    {
      kind: "proposals",
      type: "proposal",
      round: proposal.started?.round ?? proposal.done?.round ?? null,
      page: "work",
      block: null,
      item: proposal.id,
      heading: proposal.title || "",
      text,
      at: Date.parse(proposal.updatedAt ?? proposal.recordedAt) || 0,
    },
  ];
}

// A draft with no id predates completed-only drafts, and the hub discards it.
export function draftDocs(draft, at) {
  if (typeof draft?.id !== "string") return [];
  const docs = [];
  for (const [key, entry] of Object.entries(draft.items ?? {})) {
    const value = entry?.value;
    if (!value || typeof value !== "object") continue;
    const [group] = key.split("/");
    const base = {
      round: value.round ?? null,
      page: value.topic ?? null,
      block: null,
      item: key,
      draft: true,
      from: "reviewer",
      at,
    };
    if (group === "note" && value.text)
      docs.push({
        ...base,
        kind: "notes",
        type: "note",
        heading: value.anchor ?? "",
        text: clean(value.text),
      });
    if (group === "answer" && value.text)
      docs.push({
        ...base,
        kind: "answers",
        type: "typed answer",
        heading: value.label ?? "",
        text: clean(value.text),
      });
    if (group === "choice") {
      const text = clean(chosen(value));
      if (text)
        docs.push({
          ...base,
          kind: "answers",
          type: "chosen option",
          heading: value.label ?? "",
          text,
        });
    }
  }
  return docs;
}

// status.json holds the session's title and each page's title. A page title's
// result draws the top of its page.
export function titleDocs(status) {
  const base = { kind: "pages", item: null };
  const started = Date.parse(status.startedAt) || 0;
  const docs = [];
  const title = status.title || status.current?.title;
  if (title)
    docs.push({
      ...base,
      type: "session title",
      round: null,
      page: null,
      block: null,
      heading: "Session title",
      text: title,
      at: started,
    });
  const published = new Map(
    (status.rounds ?? []).map((entry) => [entry.round, entry.publishedAt]),
  );
  for (const [round, set] of Object.entries(status.roundPages ?? {}))
    for (const slot of set.pages ?? [])
      docs.push({
        ...base,
        type: "page title",
        round,
        page: slot.id,
        block: 0,
        heading: slot.title,
        text: "",
        at: Date.parse(published.get(round)) || started,
      });
  return docs;
}
