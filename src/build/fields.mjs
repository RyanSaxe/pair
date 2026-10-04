// The fields a page source may contain, as guide/pages.md and
// guide/agreements.md list them. pair build refuses any other field, because
// a field it ignored, such as css written at the top level instead of in
// page, would reach the reviewer as a round without it.
const topFields = ["name", "round", "title", "page"];
const pageFields = ["id", "title", "file", "html", "css", "js", "prototypes"];
const pageTakes =
  "A page takes id, title, file or html, css, js and prototypes; Agreed's page also takes task and agreements.";
const levels = {
  source: {
    fields: topFields,
    takes: "A page source takes name, round, title and page.",
  },
  page: { fields: pageFields, takes: pageTakes },
  agreed: { fields: [...pageFields, "task", "agreements"], takes: pageTakes },
  task: {
    fields: ["title", "html", "change"],
    takes: "The task takes title, html and change.",
  },
  agreement: {
    fields: [
      ...["id", "title", "html", "file", "state", "change"],
      ...["sourceRefs", "source", "href"],
    ],
    takes:
      "An agreement takes id, title, html or file, state, change, sourceRefs or source, and href.",
  },
  sourceRef: {
    fields: [
      ...["kind", "submissionId", "noteId", "choiceId", "answerId"],
      ...["threadId", "text"],
    ],
    takes:
      "A source reference takes kind, submissionId with noteId, choiceId or answerId, threadId, and text.",
  },
};
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);

// Where a field of the top level or of Agreed's page goes, when an author
// writes it at the other one.
function belongs(field) {
  if (topFields.includes(field))
    return `${field} goes at the top level of the source.`;
  if (!levels.agreed.fields.includes(field)) return null;
  return `${field} goes in ${pageFields.includes(field) ? "page" : "Agreed's page"}.`;
}

// Every field of a page source that pair does not know, one line each.
export function fieldProblems(source) {
  const problems = [];
  const check = (value, level, at) => {
    if (!isObject(value)) return;
    for (const field of Object.keys(value)) {
      if (levels[level].fields.includes(field)) continue;
      const moved = ["source", "page", "agreed"].includes(level)
        ? belongs(field)
        : null;
      problems.push(
        `${at ? `${at}.${field}` : field} is not a field of ${at || "the source"}. ${moved || levels[level].takes}`,
      );
    }
  };
  const page = source?.page;
  const agreed = page?.id === "agreed";
  check(source, "source", "");
  check(page, agreed ? "agreed" : "page", "page");
  if (!agreed) return problems;
  check(page.task, "task", "page.task");
  for (const [index, entry] of list(page.agreements).entries()) {
    const at = `page.agreements[${index}]`;
    check(entry, "agreement", at);
    for (const [ref, item] of list(entry?.sourceRefs).entries())
      check(item, "sourceRef", `${at}.sourceRefs[${ref}]`);
  }
  return problems;
}
