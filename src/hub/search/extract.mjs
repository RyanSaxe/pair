import { parse, textOf } from "./html.mjs";

/* Each function here turns one record from a session's files into search
   documents. A document has its kind, one of the modal's six, and the type
   the matcher ranks by, and it names where it lives: round, page, block and
   item.

   One rule reads every block of a page, so a component needs no code here. A
   block's text is its text nodes and its attributes. The only knowledge of a
   component is that a diff keeps its patch as JSON in a textarea. */

// An attribute named here holds no words a reader would search for.
const NOT_TEXT = new Set(["id", "class", "style", "src", "href"]);
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

function collect(node, page, out, inSvg = false) {
  if (node.text !== undefined) {
    out.push(node.text);
    return out;
  }
  const svg = inSvg || node.tag === "svg";
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if (NOT_TEXT.has(name) || !value || svg) continue;
    if (name === "data-prototype") {
      const prototype = (page.prototypes ?? []).find((p) => p.id === value);
      if (prototype)
        out.push(
          prototype.title ?? "",
          prototype.description ?? "",
          prototypeText(prototype.html ?? ""),
        );
    } else out.push(value);
  }
  if (node.tag === "style" || node.tag === "template") return out;
  if (node.tag === "textarea") {
    try {
      const raw = (node.raw ?? "").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
      out.push(JSON.parse(raw).patch ?? "");
    } catch {
      out.push(node.raw ?? "");
    }
    return out;
  }
  if (node.raw) out.push(node.raw);
  for (const child of node.children ?? []) collect(child, page, out, svg);
  return out;
}

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
export function pageDocs(page, round, at) {
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
  for (const child of parse(page.html ?? "").children) {
    if (child.text !== undefined) {
      const text = clean(child.text);
      if (text) docs.push({ ...base, block: null, heading, text });
      continue;
    }
    index++;
    if (child.tag === "style") continue;
    const text = clean(collect(child, page, []).join(" "));
    if (isHeading(child.tag)) heading = text;
    if (text)
      docs.push({
        ...base,
        block: index,
        heading,
        text,
        ...(holdsCode(child) ? { code: true } : {}),
      });
  }
  if (page.jsText && page.jsText.length <= SCRIPT_LIMIT) {
    const text = clean(page.jsText);
    if (text)
      docs.push({
        ...base,
        block: null,
        heading: page.title ?? "",
        text,
        code: true,
      });
  }
  return docs;
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

// A thread on a block names it in its target, so the preview can draw the
// block under the message.
function targetBlock(target, topic) {
  const match = /^block-(.+)-(\d+)$/.exec(target ?? "");
  return match && match[1] === topic ? Number(match[2]) : null;
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
      block: targetBlock(thread.target, thread.topic),
      item: `${thread.id}/${index}`,
      heading: thread.page || thread.anchor || "",
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

export function proposalDocs(proposal) {
  const parts = (proposal.status?.parts ?? []).map((part) => part.text);
  const text = clean(
    [proposal.title, proposal.delivers, ...parts, proposal.withdrawn?.reason]
      .filter(Boolean)
      .join(". "),
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
