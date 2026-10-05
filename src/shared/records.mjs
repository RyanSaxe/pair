import { jsonScript, requireValue } from "./util.mjs";

export const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export const roundPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
// Page IDs the frame keeps for its own pages. The frame opens the page that
// the address's # part names, and for each of these it opens its own page:
// - agreed is Agreed so far, which only Agreed's source may name.
// - feedback is Review, called Feedback on a past round.
// - work is Work, which lists the session's proposals.
const reservedPageIds = ["agreed", "feedback", "work"];
const reserved = `${reservedPageIds.slice(0, -1).join(", ")} and ${reservedPageIds.at(-1)} are reserved`;
// A page ID is valid, not yet used in its round, and not reserved.
const freePageId = (id, ids) =>
  idPattern.test(id || "") && !reservedPageIds.includes(id) && !ids.has(id);
const titled = (item) => typeof item.title === "string" && item.title.trim();
export function readPlanData(html) {
  const match = html.match(jsonScript("plan-data"));
  requireValue(
    match,
    'HTML requires an application/json script with id="plan-data"',
  );
  return validPlan(JSON.parse(match[1]));
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
  requireValue(
    typeof data.title === "string" && data.title.trim(),
    "title is required",
  );
  requireValue(
    Array.isArray(data.pages) &&
      (data.pages.length > 0 || data.pageMode === "partial"),
    "At least one page is required",
  );
  const ids = new Set();
  if (data.agreements !== undefined) {
    requireValue(Array.isArray(data.agreements), "agreements must be an array");
    const agreementIds = new Set();
    for (const entry of data.agreements) {
      requireValue(
        entry &&
          typeof entry.id === "string" &&
          idPattern.test(entry.id) &&
          !agreementIds.has(entry.id),
        `Alignment ID ${JSON.stringify(entry?.id)} is not valid or is used twice. Give each alignment its own ID of 1 to 80 letters, digits, "_" or "-".`,
      );
      agreementIds.add(entry.id);
      requireValue(
        ["title", "html"].every(
          (key) => typeof entry[key] === "string" && entry[key].trim(),
        ),
        `Alignment ${entry.id} needs a title and html.`,
      );
      requireValue(
        (typeof entry.source === "string" && entry.source.trim()) ||
          (Array.isArray(entry.sourceRefs) && entry.sourceRefs.length > 0),
        `Alignment ${entry.id} needs source text or sourceRefs.`,
      );
      if (entry.sourceRefs !== undefined) {
        requireValue(
          Array.isArray(entry.sourceRefs),
          "sourceRefs must be an array",
        );
        for (const ref of entry.sourceRefs) {
          requireValue(
            ref &&
              ["note", "choice", "answer", "conversation", "thread"].includes(
                ref.kind,
              ),
            "A source reference's kind is note, choice, answer, conversation or thread.",
          );
          if (ref.kind === "conversation")
            requireValue(
              typeof ref.text === "string" && ref.text.trim(),
              "Conversation source requires text",
            );
          else if (ref.kind === "thread")
            requireValue(
              idPattern.test(ref.threadId || ""),
              "Thread source requires threadId",
            );
          else {
            requireValue(
              idPattern.test(ref.submissionId || ""),
              "Invalid source submission ID",
            );
            const key = sourceItemKey(ref.kind);
            requireValue(
              typeof ref[key] === "string" && ref[key].length > 0,
              `A ${ref.kind} source reference needs ${key}.`,
            );
          }
        }
      }
      requireValue(
        entry.state === undefined ||
          ["agreed", "reopened", "retired"].includes(entry.state),
        "An alignment's state is agreed, reopened or retired.",
      );
      requireValue(
        entry.change === undefined || ["new", "updated"].includes(entry.change),
        "An alignment's change is new or updated.",
      );
      if (entry.href !== undefined) {
        requireValue(
          typeof entry.href === "string" && entry.href.trim(),
          "Invalid agreement source URL",
        );
        const url = new URL(entry.href, "http://127.0.0.1/");
        requireValue(
          ["http:", "https:"].includes(url.protocol),
          "Unsafe agreement source URL",
        );
      }
    }
  }
  const prototypeIds = new Set();
  if (data.prototypes !== undefined) {
    requireValue(Array.isArray(data.prototypes), "prototypes must be an array");
    for (const prototype of data.prototypes) {
      requireValue(
        prototype &&
          idPattern.test(prototype.id || "") &&
          !prototypeIds.has(prototype.id),
        "Prototype IDs must be valid and unique",
      );
      prototypeIds.add(prototype.id);
      requireValue(
        typeof prototype.title === "string" &&
          prototype.title.trim() &&
          typeof prototype.html === "string" &&
          prototype.html.trim(),
        "Prototypes require title and HTML",
      );
      requireValue(
        Number.isFinite(prototype.height) && prototype.height > 0,
        "Prototype height must be positive",
      );
    }
  }
  for (const page of data.pages) {
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
  if (data.task !== undefined) validTask(data.task);
  for (const content of [...data.pages, ...(data.agreements || [])]) {
    for (const match of content.html.matchAll(
      /<[a-z][^>]*?\sdata-prototype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    ))
      requireValue(
        prototypeIds.has(match[1] ?? match[2] ?? match[3]),
        `data-prototype="${match[1] ?? match[2] ?? match[3]}" names no prototype in the page's prototypes.`,
      );
  }
  return data;
}
// The task opens Agreed: what the plan is building towards, in a title and a
// few sentences.
function validTask(task) {
  requireValue(
    task && typeof task === "object" && !Array.isArray(task),
    'page "agreed": Agreed has no task. State what the plan is building towards.',
  );
  requireValue(
    typeof task.title === "string" && task.title.trim(),
    'page "agreed": the task has no title',
  );
  requireValue(
    typeof task.html === "string" && task.html.trim(),
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
export function validPage(record) {
  const page = record?.page;
  requireValue(page && typeof page === "object", "Page record requires page");
  requireValue(
    idPattern.test(page.id || ""),
    `Page ID ${JSON.stringify(page.id)} is not valid. A page ID is 1 to 80 letters, digits, "_" or "-".`,
  );
  requireValue(titled(page), "Page title is required");
  requireValue(
    page.id === "agreed"
      ? Array.isArray(page.agreements)
      : typeof page.html === "string" && page.html.trim(),
    "Agreed requires agreements; other pages require HTML",
  );
  if (page.id === "agreed") validTask(page.task);
  for (const key of ["cssText", "jsText"])
    requireValue(
      page[key] === undefined || typeof page[key] === "string",
      `${key} must be text`,
    );
  if (page.jsText)
    requireValue(
      /export\s+(?:async\s+)?function\s+setup\s*\(/.test(page.jsText),
      "Page JavaScript must export setup(root, planUI)",
    );
  if (
    /<\/style/i.test(page.cssText || "") ||
    /<\/script/i.test(page.jsText || "")
  )
    requireValue(false, "Page CSS/JS cannot contain closing style/script tags");
  validPlan(pagePlan(record));
  return record;
}
// A page record as plan data on its own: Agreed carries the agreements and
// the task, and any other page carries itself.
export function pagePlan({ page, ...record }) {
  const agreed = page.id === "agreed";
  return {
    name: record.name,
    round: record.round,
    title: record.title,
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
    "List at least one page",
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
// Agreed lists the decisions that changed most recently first, and keeps the
// agent's order among decisions that changed in the same round.
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
  if (ref.kind === "note")
    return payload.groups?.notes?.find((note) => note.id === ref.noteId);
  if (ref.kind === "choice") return payload.groups?.choices?.[ref.choiceId];
  return payload.groups?.answers?.[ref.answerId];
}
