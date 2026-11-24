import { enhance } from "#frame/app/components.mjs";
import { callHook } from "#frame/app/hooks.mjs";
import { state } from "#frame/app/store.mjs";
import { linkButton, tag } from "#frame/app/ui.mjs";
import { $, plural } from "#frame/app/util.mjs";
import {
  agreedTask,
  agreements,
  base,
  editable,
  online,
  topicTitle,
} from "#frame/app/view.mjs";
import { metaLine } from "#frame/pages/work-model.mjs";

export { linkButton, tag } from "#frame/app/ui.mjs";

function agreementLabel(entry) {
  if (entry.state === "reopened") return ["Revisiting", "attention"];
  if (entry.state === "retired") return ["No longer applies", "muted"];
  if (entry.change === "new") return ["New", "accent"];
  if (entry.change === "updated") return ["Updated", "accent"];
  return null;
}

function describeRecord(record) {
  const where = topicTitle(record.topic) || record.topic;
  if (record.kind === "note") return `your note on ${where}`;
  if (record.kind === "thread") {
    const on = record.proposal ? record.label : where;
    return on ? `your thread on ${on}` : "your thread";
  }
  if (record.kind === "answer") return `your answer to “${record.label}”`;
  return `your choice “${record.text}” for ${record.label}`;
}

// A thread on a proposal's card belongs to no round.
function recordLine(record, separator) {
  const what = describeRecord(record);
  return record.round
    ? `Round ${record.round}${separator}${what}`
    : what[0].toUpperCase() + what.slice(1);
}

// Only a frame on the hub has Work, so a saved round has no link to a card. A
// source stored with no round and no card has nowhere to open.
const hasLink = (record) => record.round || (online && record.proposal);

// In the live reader, openInTab() makes a source's Open link load its round
// into the left tab at the page and block in the link, or show its thread on
// Work. A modified click still opens the page in a new tab.
function openInTab(link, record) {
  if (!editable) return;
  link.addEventListener("click", (event) => {
    if (
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (record.proposal) {
      callHook("show", "work", `thread-${record.threadId}`);
    } else {
      void callHook("openPast", record.round, {
        pageId: record.topic,
        targetId: record.target,
      });
    }
  });
}

function recordUrl(record, route) {
  if (record.proposal) {
    return `${base}/?target=${encodeURIComponent(`thread-${record.threadId}`)}#work`;
  }
  const params = new URLSearchParams();
  if (record.target) params.set("target", record.target);
  if (record.quote) params.set("quote", record.quote);
  if (record.occurrence) params.set("occurrence", record.occurrence);
  const search = params.toString();
  return `${base}/${route}/${encodeURIComponent(record.round)}${search ? "?" + search : ""}#${encodeURIComponent(record.topic)}`;
}

function dotSeparator() {
  const dot = document.createElement("span");
  dot.textContent = "·";
  return dot;
}

function sourceSummary(entry, records, first) {
  if (first) return recordLine(first, ", ");
  if (records.length) return "From the conversation";
  if (entry.source) return "Source noted by the agent";
  return "";
}

function agreementBody(entry, records, first) {
  const body = document.createElement("div");
  body.className = "agreement-body";
  const title = document.createElement("h2");
  title.textContent = entry.title;
  const noteCount = state.notes.filter(
    (note) => note.agreementId === entry.id,
  ).length;
  const source = sourceSummary(entry, records, first);
  const rest = document.createElement("span");
  rest.textContent = [noteCount ? plural(noteCount, "note") : "", source]
    .filter(Boolean)
    .join(" · ");
  rest.title = rest.textContent;
  const [label, tone] = agreementLabel(entry) || [];
  const content = document.createElement("div");
  content.innerHTML = entry.html;
  body.append(title);
  if (label || rest.textContent) {
    body.append(metaLine(label, tone, rest.textContent ? rest : null));
  }
  body.append(content);
  return body;
}

function openRecordLink(record, { text, className, inTab }) {
  const open = document.createElement("a");
  if (className) open.className = className;
  open.textContent = text;
  if (online) {
    open.href = recordUrl(record, "r");
    if (inTab) openInTab(open, record);
  } else {
    open.href = record.href;
    open.target = "_blank";
    open.rel = "noopener";
  }
  return open;
}

function extraRecordBox(record) {
  const box = document.createElement("div");
  box.className = "record";
  const meta = document.createElement("span");
  meta.className = "small";
  meta.textContent =
    record.kind === "conversation"
      ? "Conversation · agent-provided context"
      : recordLine(record, " · ");
  box.append(meta);
  if (record.quote) {
    const quote = document.createElement("blockquote");
    quote.textContent = record.quote;
    box.append(quote);
  }
  const line = document.createElement("span");
  line.textContent = record.text;
  box.append(line);
  if (record.kind !== "conversation" && hasLink(record)) {
    box.append(
      openRecordLink(record, {
        text: " Open",
        className: "context-link",
        inTab: false,
      }),
    );
  }
  return box;
}

function agreementDetails(entry, extra) {
  const details = document.createElement("div");
  details.className = "agreement-sources";
  details.hidden = true;
  if (entry.source) {
    const legacy = document.createElement("p");
    legacy.textContent = entry.source;
    details.append(legacy);
  }
  for (const record of extra) details.append(extraRecordBox(record));
  if (entry.href) {
    const link = document.createElement("a");
    link.href = entry.href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open source ↗";
    details.append(link);
  }
  return details;
}

function moreLabel(first, count) {
  if (first) return `${count} more`;
  return count > 1 ? `${count} sources` : "Details";
}

function appendPrimaryActions(actions, first, preview) {
  // A preview shows one round's page, and a thread on a card is on Work.
  if (first?.round && online) {
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
    actions.append(toggle, dotSeparator());
  }
  if (first && hasLink(first)) {
    actions.append(openRecordLink(first, { text: "Open", inTab: true }));
  }
}

function agreementCard(entry) {
  const card = document.createElement("section");
  card.className = "agreement-card";
  card.id = "agreement-" + entry.id;
  // The comment control uses data-kind to name a chosen card.
  card.dataset.kind = "alignment";
  const records = entry.sourceRecords || [];
  const first = records.find((record) => record.kind !== "conversation");
  card.append(agreementBody(entry, records, first));
  const strip = document.createElement("div");
  strip.className = "agreement-source";
  const actions = document.createElement("div");
  actions.className = "actions";
  const preview = document.createElement("div");
  preview.className = "agreement-preview";
  preview.append(document.createElement("div"));
  appendPrimaryActions(actions, first, preview);
  const extra = records.filter((record) => record !== first);
  const details = agreementDetails(entry, extra);
  if (details.children.length) {
    if (actions.children.length) actions.append(dotSeparator());
    const count = extra.length + (entry.source ? 1 : 0) + (entry.href ? 1 : 0);
    actions.append(
      linkButton(moreLabel(first, count), () => {
        details.hidden = !details.hidden;
      }),
    );
  }
  strip.append(actions);
  strip.hidden = !actions.children.length;
  card.append(strip, details, preview);
  return card;
}

function taskChangeText(change) {
  if (change === "new") return "New in this round";
  if (change === "updated") return "Updated in this round";
  return "";
}

// The task card is a statement, never a checklist, and has nothing for the
// reviewer to approve.
function taskCard() {
  const card = document.createElement("section");
  card.className = "agreement-card task-card";
  card.id = "agreement-task";
  card.dataset.kind = "task";
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
  text.textContent = taskChangeText(agreedTask.change);
  strip.append(text);
  strip.hidden = !text.textContent;
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
  root.append(agreedLabel("Alignments"));
  if (agreements.length) {
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
  } else {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No alignments recorded yet.";
    root.append(empty);
  }
  return enhance(root);
}
