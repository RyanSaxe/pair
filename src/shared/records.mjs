import { jsonScript, requireValue } from "./util.mjs";

export const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export const roundPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
// The frame uses these page IDs for its own pages. It opens the page that the
// address's # part names, and each of these IDs opens a frame page:
// - agreed is Agreed so far, which only Agreed's source may use.
// - feedback is Review, called What you sent on a past round.
// - work is Work, which lists the session's proposals.
const reservedPageIds = ["agreed", "feedback", "work"];
const reserved = `${reservedPageIds.slice(0, -1).join(", ")} and ${reservedPageIds.at(-1)} are reserved`;
const freePageId = (id, ids) =>
  idPattern.test(id || "") && !reservedPageIds.includes(id) && !ids.has(id);
const nonEmptyString = (value) =>
  typeof value === "string" && Boolean(value.trim());
const titled = (item) => nonEmptyString(item.title);
const sourceRefKinds = new Set([
  "note",
  "choice",
  "answer",
  "conversation",
  "thread",
]);
const prototypeRefPattern =
  /<[a-z][^>]*?\sdata-prototype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

export function readPlanData(html) {
  const match = html.match(jsonScript("plan-data"));
  requireValue(
    match,
    'HTML requires an application/json script with id="plan-data"',
  );
  return validPlan(JSON.parse(match[1]));
}

function validSourceRef(ref) {
  requireValue(
    ref && sourceRefKinds.has(ref.kind),
    "A source reference's kind is note, choice, answer, conversation or thread.",
  );
  if (ref.kind === "conversation") {
    requireValue(nonEmptyString(ref.text), "Conversation source requires text");
    return;
  }
  if (ref.kind === "thread") {
    requireValue(
      idPattern.test(ref.threadId || ""),
      "Thread source requires threadId",
    );
    return;
  }
  requireValue(
    idPattern.test(ref.submissionId || ""),
    "Invalid source submission ID",
  );
  const key = sourceItemKey(ref.kind);
  requireValue(
    typeof ref[key] === "string" && ref[key].length > 0,
    `${/^[aeiou]/.test(ref.kind) ? "An" : "A"} ${ref.kind} source reference needs ${key}.`,
  );
}

function validAgreementHref(href) {
  if (href === undefined) return;
  requireValue(nonEmptyString(href), "Invalid agreement source URL");
  const url = new URL(href, "http://127.0.0.1/");
  requireValue(
    ["http:", "https:"].includes(url.protocol),
    "Unsafe agreement source URL",
  );
}

function validAgreementMeta(entry) {
  requireValue(
    entry.state === undefined ||
      ["agreed", "reopened", "retired"].includes(entry.state),
    "An alignment's state is agreed, reopened or retired.",
  );
  requireValue(
    entry.change === undefined || ["new", "updated"].includes(entry.change),
    "An alignment's change is new or updated.",
  );
  validAgreementHref(entry.href);
}

function validAgreement(entry, agreementIds) {
  const validId =
    entry &&
    typeof entry.id === "string" &&
    idPattern.test(entry.id) &&
    !agreementIds.has(entry.id);
  requireValue(
    validId,
    `Alignment ID ${JSON.stringify(entry?.id)} is not valid or is used twice. Give each alignment its own ID of 1 to 80 letters, digits, "_" or "-".`,
  );
  agreementIds.add(entry.id);
  requireValue(
    ["title", "html"].every((key) => nonEmptyString(entry[key])),
    `Alignment ${entry.id} needs a title and html.`,
  );
  const hasSource =
    nonEmptyString(entry.source) ||
    (Array.isArray(entry.sourceRefs) && entry.sourceRefs.length > 0);
  requireValue(
    hasSource,
    `Alignment ${entry.id} needs source text or sourceRefs.`,
  );
  if (entry.sourceRefs !== undefined) {
    requireValue(
      Array.isArray(entry.sourceRefs),
      "sourceRefs must be an array",
    );
    for (const ref of entry.sourceRefs) validSourceRef(ref);
  }
  validAgreementMeta(entry);
}

function validAgreements(agreements) {
  if (agreements === undefined) return;
  requireValue(Array.isArray(agreements), "agreements must be an array");
  const agreementIds = new Set();
  for (const entry of agreements) validAgreement(entry, agreementIds);
}

function validPrototypes(prototypes) {
  const prototypeIds = new Set();
  if (prototypes === undefined) return prototypeIds;
  requireValue(Array.isArray(prototypes), "prototypes must be an array");
  for (const prototype of prototypes) {
    requireValue(
      prototype &&
        idPattern.test(prototype.id || "") &&
        !prototypeIds.has(prototype.id),
      "Prototype IDs must be valid and unique",
    );
    prototypeIds.add(prototype.id);
    requireValue(
      nonEmptyString(prototype.title) && nonEmptyString(prototype.html),
      "Prototypes require title and HTML",
    );
    requireValue(
      Number.isFinite(prototype.height) && prototype.height > 0,
      "Prototype height must be positive",
    );
  }
  return prototypeIds;
}

function validPages(pages) {
  const ids = new Set();
  for (const page of pages) {
    requireValue(
      freePageId(page.id, ids),
      `Page ID ${JSON.stringify(page.id)} cannot be used. A page ID is 1 to 80 letters, digits, "_" or "-", no two pages share one, and ${reserved}.`,
    );
    requireValue(
      titled(page) && typeof page.html === "string",
      "Pages require title and html",
    );
    ids.add(page.id);
  }
}

function validPrototypeRefs(contents, prototypeIds) {
  for (const content of contents) {
    for (const match of content.html.matchAll(prototypeRefPattern)) {
      const refId = match[1] ?? match[2] ?? match[3];
      requireValue(
        prototypeIds.has(refId),
        `data-prototype="${refId}" names no prototype in the page's prototypes.`,
      );
    }
  }
}

function validPlan(data) {
  requireValue(
    idPattern.test(data.name || ""),
    '"name" in the page source takes 1 to 80 letters, digits, "_" or "-", starting with a letter or digit.',
  );
  requireValue(
    roundPattern.test(data.round || ""),
    '"round" in the page source takes 1 to 80 letters, digits, ".", "_" or "-", starting with a letter or digit, such as "3".',
  );
  requireValue(nonEmptyString(data.title), "title is required");
  requireValue(
    Array.isArray(data.pages) &&
      (data.pages.length > 0 || data.pageMode === "partial"),
    "At least one page is required",
  );
  validAgreements(data.agreements);
  const prototypeIds = validPrototypes(data.prototypes);
  validPages(data.pages);
  if (data.task !== undefined) validTask(data.task);
  validPrototypeRefs([...data.pages, ...(data.agreements || [])], prototypeIds);
  return data;
}
function validTask(task) {
  requireValue(
    task && typeof task === "object" && !Array.isArray(task),
    'page "agreed": Agreed has no task. State what the plan is building towards.',
  );
  requireValue(
    nonEmptyString(task.title),
    'page "agreed": the task has no title',
  );
  requireValue(
    nonEmptyString(task.html),
    'page "agreed": the task has no text',
  );
  requireValue(
    task.change === undefined || ["new", "updated"].includes(task.change),
    'page "agreed": the task\'s change is new or updated',
  );
}
export function pageData(html) {
  const match = html.match(jsonScript("page-data"));
  requireValue(match, "Invalid page record");
  let record;
  try {
    record = JSON.parse(match[1]);
  } catch {
    requireValue(false, "Invalid page record");
  }
  return validPage(record);
}

function validPagePlanFlag(record, isAgreed) {
  if (record.plan === undefined) return;
  requireValue(
    isAgreed && typeof record.plan === "boolean",
    isAgreed
      ? '"plan" in Agreed\'s source is true or false.'
      : '"plan" is a field of Agreed\'s source only.',
  );
}

function validPageAssets(page) {
  for (const key of ["cssText", "jsText"]) {
    requireValue(
      page[key] === undefined || typeof page[key] === "string",
      `${key} must be text`,
    );
  }
  if (page.jsText) {
    requireValue(
      exportsSetup(page.jsText),
      "Page JavaScript must export setup(root, planUI)",
    );
  }
  const hasClosingTag =
    /<\/style/i.test(page.cssText || "") ||
    /<\/script/i.test(page.jsText || "");
  requireValue(
    !hasClosingTag,
    "Page CSS/JS cannot contain closing style/script tags",
  );
}

export function validPage(record) {
  const page = record?.page;
  requireValue(page && typeof page === "object", "Page record requires page");
  requireValue(
    idPattern.test(page.id || ""),
    `Page ID ${JSON.stringify(page.id)} is not valid. A page ID is 1 to 80 letters, digits, "_" or "-".`,
  );
  requireValue(titled(page), "Page title is required");
  const isAgreed = page.id === "agreed";
  requireValue(
    isAgreed ? Array.isArray(page.agreements) : nonEmptyString(page.html),
    "Agreed requires agreements; other pages require HTML",
  );
  if (isAgreed) validTask(page.task);
  validPagePlanFlag(record, isAgreed);
  validPageAssets(page);
  validPlan(pagePlan(record));
  return record;
}
// The frame calls the setup function that the page's module exports.
// exportsSetup() removes the comments first and keeps each string whole, so an
// export inside a comment does not count.
function exportsSetup(js) {
  const code = js.replace(
    /("(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, string) => string ?? "",
  );
  return /\bexport\s+(?:(?:async\s+)?function\s+setup\s*\(|(?:const|let|var)\s+setup\s*=|\{[^}]*?\b(?:\w+\s+as\s+)?setup\s*[,}])/.test(
    code,
  );
}
export function pagePlan({ page, ...record }) {
  const agreed = page.id === "agreed";
  return {
    name: record.name,
    round: record.round,
    title: record.title,
    ...(agreed && record.plan ? { plan: true } : {}),
    pageMode: "partial",
    pages: agreed ? [] : [{ id: page.id, title: page.title, html: page.html }],
    agreements: agreed ? page.agreements : [],
    task: agreed ? page.task : undefined,
    prototypes: page.prototypes || [],
  };
}
export function pageList(items) {
  requireValue(
    Array.isArray(items) && items.length > 0,
    'Publish Agreed with --pages SRC/pages.json, a file that lists the pages after Agreed as { "pages": [{ "id": "…", "title": "…" }] }.',
  );
  const ids = new Set();
  for (const item of items) {
    requireValue(
      item && freePageId(item.id, ids) && titled(item),
      `Give each page in pages.json a title and an ID that no other page has, and remember that ${reserved}.`,
    );
    ids.add(item.id);
  }
  return items.map(({ id, title }) => ({
    id,
    title,
    state: "queued",
    version: null,
  }));
}
// orderAgreements() puts the decisions that changed most recently first, and
// keeps the agent's order among decisions that changed in the same round.
export function orderAgreements(entries, earlier) {
  const byId = new Map(earlier.map((entry) => [entry.id, entry]));
  const next =
    Math.max(0, ...earlier.map((entry) => entry.lastChangedOrder || 0)) + 1;
  entries.forEach((entry, index) => {
    const old = byId.get(entry.id);
    const same =
      old &&
      ["title", "html", "state"].every(
        (key) => (old[key] || null) === (entry[key] || null),
      );
    entry.lastChangedOrder = same ? old.lastChangedOrder || 0 : next;
    entry.authoredOrder = index;
  });
  entries.sort(
    (a, b) =>
      b.lastChangedOrder - a.lastChangedOrder ||
      a.authoredOrder - b.authoredOrder,
  );
}
function sourceItemKey(kind) {
  return { note: "noteId", choice: "choiceId", answer: "answerId" }[kind];
}
export function sourceItem(payload, ref) {
  if (ref.kind === "note") {
    return payload.groups?.notes?.find((note) => note.id === ref.noteId);
  }
  if (ref.kind === "choice") return payload.groups?.choices?.[ref.choiceId];
  return payload.groups?.answers?.[ref.answerId];
}
