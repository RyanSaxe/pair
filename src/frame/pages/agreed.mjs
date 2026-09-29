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
  plan,
} from "#frame/app/view.mjs";
import { openNote } from "#frame/notes/notes.mjs";
import {
  openCount,
  sideWorkItems,
  sideWorkSection,
} from "#frame/pages/side-work.mjs";
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
const decisionsPanel = "agreed-decisions";
const sideWorkPanel = "side-work";
const tabsByRound = new Map();

function tabCount(count) {
  const number = document.createElement("span");
  number.className = "agreed-tab-count";
  number.textContent = count ? String(count) : "";
  number.hidden = !count;
  return number;
}
function defaultAgreedTab(items) {
  return !agreements.length && items.length ? sideWorkPanel : decisionsPanel;
}
function agreedTabs() {
  const items = sideWorkItems();
  const activeCount = agreements.filter(
    (entry) => entry.state !== "retired",
  ).length;
  const tabs = document.createElement("div");
  tabs.id = "agreed-tabs";
  tabs.className = "vd-tablist agreed-tabs";

  if (!items.length) {
    tabs.classList.add("agreed-tabs-plain");
    const label = document.createElement("span");
    label.className = "agreed-tab-label";
    label.textContent = "Decisions";
    label.tabIndex = -1;
    tabs.append(label, tabCount(activeCount));
    return tabs;
  }

  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Agreed");
  for (const [panel, label, count] of [
    [decisionsPanel, "Decisions", activeCount],
    [sideWorkPanel, "Side work", openCount(items)],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `agreed-tab-${panel === decisionsPanel ? "decisions" : "side-work"}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panel);
    button.setAttribute("aria-selected", "false");
    button.tabIndex = -1;
    const title = document.createElement("span");
    title.className = "agreed-tab-label";
    title.textContent = label;
    button.append(title, tabCount(count));
    tabs.append(button);
  }
  tabs.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && tabs.contains(tab))
      showAgreedTab(tab.getAttribute("aria-controls"));
  });
  tabs.addEventListener("keydown", (event) => {
    const list = [...tabs.querySelectorAll('[role="tab"]')];
    const index = list.indexOf(event.target.closest('[role="tab"]'));
    if (index < 0) return;
    let next;
    if (event.key === "ArrowLeft")
      next = (index - 1 + list.length) % list.length;
    if (event.key === "ArrowRight") next = (index + 1) % list.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = list.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    list[next].focus();
    showAgreedTab(list[next].getAttribute("aria-controls"));
  });
  return tabs;
}
export function showAgreedTab(panelId) {
  const root = $("page-content");
  const panels = [...root.querySelectorAll(":scope > .agreed-panel")];
  if (!panels.some((panel) => panel.id === panelId)) return;
  const tabs = [...($("agreed-tabs")?.querySelectorAll('[role="tab"]') || [])];
  if (!tabs.length) {
    if (panelId !== decisionsPanel) return;
    for (const panel of panels) {
      panel.hidden = panel.id !== decisionsPanel;
      panel.removeAttribute("role");
      panel.removeAttribute("aria-labelledby");
    }
    return;
  }
  if (!tabs.some((tab) => tab.getAttribute("aria-controls") === panelId))
    return;
  for (const panel of panels) {
    panel.hidden = panel.id !== panelId;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute(
      "aria-labelledby",
      `agreed-tab-${panel.id === decisionsPanel ? "decisions" : "side-work"}`,
    );
  }
  for (const tab of tabs) {
    const selected = tab.getAttribute("aria-controls") === panelId;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  tabsByRound.set(plan.round, panelId);
}
export function refreshAgreedTabs() {
  const tabs = $("agreed-tabs");
  if (!tabs) return;
  const items = sideWorkItems();
  const hadSideWorkTab = Boolean($("agreed-tab-side-work"));
  const hasSideWorkTab = items.length > 0;
  const selectedPanel = tabs
    .querySelector('[role="tab"][aria-selected="true"]')
    ?.getAttribute("aria-controls");
  const focusInTabs = tabs.contains(document.activeElement);
  const focusedPanel = document.activeElement?.getAttribute("aria-controls");

  if (hadSideWorkTab !== hasSideWorkTab) {
    const replacement = agreedTabs();
    tabs.replaceWith(replacement);
    const panelId = hasSideWorkTab
      ? selectedPanel || tabsByRound.get(plan.round) || defaultAgreedTab(items)
      : decisionsPanel;
    showAgreedTab(panelId);
    if (focusInTabs) {
      const focusId = hasSideWorkTab ? focusedPanel || panelId : decisionsPanel;
      const target = [...replacement.querySelectorAll('[role="tab"]')].find(
        (tab) => tab.getAttribute("aria-controls") === focusId,
      );
      (target || replacement.querySelector(".agreed-tab-label"))?.focus({
        preventScroll: true,
      });
    }
    return;
  }

  if (hasSideWorkTab) {
    const number = tabs.querySelector(
      "#agreed-tab-side-work .agreed-tab-count",
    );
    const count = openCount(items);
    number.textContent = count ? String(count) : "";
    number.hidden = !count;
    showAgreedTab(
      selectedPanel || tabsByRound.get(plan.round) || defaultAgreedTab(items),
    );
  } else showAgreedTab(decisionsPanel);
}
export function renderAgreements() {
  const root = $("page-content");
  root.replaceChildren();
  if (agreedTask) root.append(agreedLabel("The task"), taskCard());
  const decisions = document.createElement("div");
  decisions.id = decisionsPanel;
  decisions.className = "agreed-panel";
  if (!agreements.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = agreedTask
      ? "No decisions recorded yet."
      : "No agreements recorded yet.";
    decisions.append(empty);
  } else {
    const active = agreements.filter((entry) => entry.state !== "retired");
    const retired = agreements.filter((entry) => entry.state === "retired");
    for (const entry of active) decisions.append(agreementCard(entry));
    if (retired.length) {
      const details = document.createElement("details");
      details.className = "agreement-retired";
      const summary = document.createElement("summary");
      summary.textContent = `No longer applies · ${retired.length}`;
      details.append(summary);
      for (const entry of retired) details.append(agreementCard(entry));
      decisions.append(details);
    }
  }
  const sideWork = sideWorkSection();
  root.append(agreedTabs(), decisions, sideWork);
  const items = sideWorkItems();
  showAgreedTab(
    (items.length && tabsByRound.get(plan.round)) || defaultAgreedTab(items),
  );
  enhance(root);
}
