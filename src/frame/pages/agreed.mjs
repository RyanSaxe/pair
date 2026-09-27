import { enhance } from "#frame/app/registry.mjs";
import { state } from "#frame/app/store.mjs";
import { $, plural } from "#frame/app/util.mjs";
import {
  agreedTask,
  agreements,
  base,
  editable,
  online,
  pages,
} from "#frame/app/view.mjs";
import { openNote } from "#frame/notes/notes.mjs";
import { sideWorkSection } from "#frame/pages/side-work.mjs";
import { openPast } from "#frame/sync/rounds.mjs";

/* Agreed */
function agreementLabel(entry) {
  if (entry.state === "reopened") return ["Revisiting", "attention"];
  if (entry.state === "retired") return ["No longer applies", "muted"];
  if (entry.change === "new") return ["New", ""];
  if (entry.change === "updated") return ["Updated", ""];
  return null;
}
function describeRecord(record) {
  const where =
    pages.find((item) => item.id === record.topic)?.title || record.topic;
  if (record.kind === "note") return `your note on ${where}`;
  if (record.kind === "thread") return `your thread on ${where}`;
  if (record.kind === "answer") return `your answer to “${record.label}”`;
  return `your choice “${record.text}” for ${record.label}`;
}
// In the live reader, a source's Open link loads its round into the left
// tab at the page and block it names. A modified click still opens the
// read-only page in a new tab.
function openInTab(link, record) {
  if (!editable) return;
  link.addEventListener("click", (event) => {
    if (
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    void openPast(record.round, {
      pageId: record.topic,
      targetId: record.target,
    });
  });
}
function recordUrl(record, route) {
  const params = new URLSearchParams();
  if (record.target) params.set("target", record.target);
  if (record.quote) params.set("quote", record.quote);
  if (record.occurrence) params.set("occurrence", record.occurrence);
  const search = params.toString();
  return `${base}/${route}/${encodeURIComponent(record.round)}${search ? "?" + search : ""}#${encodeURIComponent(record.topic)}`;
}
export function tag(text, tone = "") {
  const element = document.createElement("span");
  element.className = `tag ${tone}`.trim();
  element.textContent = text;
  return element;
}
export function linkButton(text, onclick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-btn";
  button.textContent = text;
  button.onclick = onclick;
  return button;
}
function agreementCard(entry) {
  const card = document.createElement("section");
  card.className = "agreement-card";
  card.id = "agreement-" + entry.id;
  const body = document.createElement("div");
  body.className = "agreement-body";
  const title = document.createElement("h2");
  title.textContent = entry.title;
  const label = agreementLabel(entry);
  if (label) title.append(tag(label[0], label[1]));
  const noteCount = state.notes.filter(
    (note) => note.agreementId === entry.id,
  ).length;
  if (noteCount) title.append(tag(plural(noteCount, "note"), "muted"));
  const content = document.createElement("div");
  content.innerHTML = entry.html;
  body.append(title, content);
  card.append(body);
  const records = entry.sourceRecords || [];
  const first = records.find((record) => record.kind !== "conversation");
  const strip = document.createElement("div");
  strip.className = "agreement-source";
  const text = document.createElement("span");
  text.textContent = first
    ? `Agreed in round ${first.round} · ${describeRecord(first)}`
    : records.length
      ? "From the conversation"
      : entry.source
        ? "Source noted by the agent"
        : "";
  const actions = document.createElement("div");
  actions.className = "actions";
  const separator = () => {
    const dot = document.createElement("span");
    dot.textContent = "·";
    return dot;
  };
  const preview = document.createElement("div");
  preview.className = "agreement-preview";
  preview.append(document.createElement("div"));
  if (first && online) {
    const toggle = linkButton("Preview", () => {
      const open = preview.classList.toggle("open");
      toggle.textContent = open ? "Hide preview" : "Preview";
      if (open && !preview.querySelector("iframe")) {
        const frame = document.createElement("iframe");
        frame.title = `Round ${first.round}: ${describeRecord(first)}`;
        frame.src = recordUrl(first, "preview");
        preview.firstElementChild.append(frame);
      }
    });
    actions.append(toggle, separator());
  }
  if (first) {
    const open = document.createElement("a");
    open.textContent = "Open";
    if (online) {
      open.href = recordUrl(first, "r");
      openInTab(open, first);
    } else {
      open.href = first.href;
      open.target = "_blank";
      open.rel = "noopener";
    }
    actions.append(open);
  }
  const details = document.createElement("div");
  details.className = "agreement-sources";
  details.hidden = true;
  const extra = records.filter((record) => record !== first);
  if (entry.source) {
    const legacy = document.createElement("p");
    legacy.textContent = entry.source;
    details.append(legacy);
  }
  for (const record of extra) {
    const box = document.createElement("div");
    box.className = "record";
    const meta = document.createElement("span");
    meta.className = "small";
    meta.textContent =
      record.kind === "conversation"
        ? "Conversation · agent-provided context"
        : `Round ${record.round} · ${describeRecord(record)}`;
    box.append(meta);
    if (record.quote) {
      const quote = document.createElement("blockquote");
      quote.textContent = record.quote;
      box.append(quote);
    }
    const line = document.createElement("span");
    line.textContent = record.text;
    box.append(line);
    if (record.kind !== "conversation") {
      const open = document.createElement("a");
      open.className = "context-link";
      open.textContent = " Open";
      if (online) open.href = recordUrl(record, "r");
      else {
        open.href = record.href;
        open.target = "_blank";
        open.rel = "noopener";
      }
      box.append(open);
    }
    details.append(box);
  }
  if (entry.href) {
    const link = document.createElement("a");
    link.href = entry.href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open source ↗";
    details.append(link);
  }
  if (details.children.length) {
    if (actions.children.length) actions.append(separator());
    const count = extra.length + (entry.source ? 1 : 0) + (entry.href ? 1 : 0);
    const more = linkButton(
      first ? `${count} more` : count > 1 ? `${count} sources` : "Details",
      () => {
        details.hidden = !details.hidden;
      },
    );
    actions.append(more);
  }
  if (editable) {
    if (actions.children.length) actions.append(separator());
    actions.append(
      linkButton("Comment", () =>
        openNote("agreed", entry.title, "", null, entry.id, card.id),
      ),
    );
  }
  strip.append(text, actions);
  card.append(strip, details, preview);
  return card;
}
// The task a reviewer reads before the decisions: a statement, never a
// checklist, with nothing on it to approve.
function taskCard() {
  const card = document.createElement("section");
  card.className = "agreement-card task-card";
  card.id = "agreement-task";
  const body = document.createElement("div");
  body.className = "agreement-body";
  const title = document.createElement("h2");
  title.textContent = agreedTask.title;
  const noteCount = state.notes.filter(
    (note) => note.agreementId === "task",
  ).length;
  if (noteCount) title.append(tag(plural(noteCount, "note"), "muted"));
  const content = document.createElement("div");
  content.innerHTML = agreedTask.html;
  body.append(title, content);
  const strip = document.createElement("div");
  strip.className = "agreement-source";
  const text = document.createElement("span");
  text.textContent =
    agreedTask.change === "new"
      ? "New in this round"
      : agreedTask.change === "updated"
        ? "Updated in this round"
        : "";
  const actions = document.createElement("div");
  actions.className = "actions";
  if (editable)
    actions.append(
      linkButton("Comment", () =>
        openNote("agreed", "The task", "", null, "task", card.id),
      ),
    );
  strip.append(text, actions);
  strip.hidden = !text.textContent && !actions.children.length;
  card.append(body, strip);
  return card;
}
function agreedLabel(text) {
  const label = document.createElement("p");
  label.className = "agreed-label";
  label.textContent = text;
  return label;
}
export function renderAgreements() {
  const root = $("page-content");
  root.replaceChildren();
  if (agreedTask) root.append(agreedLabel("The task"), taskCard());
  if (!agreements.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = agreedTask
      ? "No decisions recorded yet."
      : "No agreements recorded yet.";
    root.append(empty, sideWorkSection());
    enhance(root);
    return;
  }
  if (agreedTask) root.append(agreedLabel("Decisions"));
  const active = agreements.filter((entry) => entry.state !== "retired");
  const retired = agreements.filter((entry) => entry.state === "retired");
  for (const entry of active) root.append(agreementCard(entry));
  if (retired.length) {
    const details = document.createElement("details");
    details.className = "agreement-retired";
    const summary = document.createElement("summary");
    summary.textContent = `No longer applies · ${retired.length}`;
    details.append(summary);
    for (const entry of retired) details.append(agreementCard(entry));
    root.append(details);
  }
  root.append(sideWorkSection());
  enhance(root);
}
