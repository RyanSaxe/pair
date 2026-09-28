import { enhance } from "#frame/app/registry.mjs";
import { prefs } from "#frame/app/store.mjs";
import { ago } from "#frame/app/time.mjs";
import { $, normalize, plural, unreachable, uuid } from "#frame/app/util.mjs";
import { base, editable, page, pages, plan } from "#frame/app/view.mjs";
import { findText } from "#frame/notes/notes.mjs";
import { partOf, threadTitle } from "#frame/notes/thread-head.mjs";
import { remote } from "#frame/sync/rounds.mjs";

/* Threads. A note the reviewer sends to the agent at once, shown as a card
   under its block with the agent's replies, without changing the page. The
   hub stores each thread and every status poll carries them all, so the
   cards follow the poll, and a message this browser sent shows at once and
   until the poll has it. */

// ⌘ Enter on Apple systems and Ctrl Enter elsewhere send a thread or a
// reply, and the dialog's hints say which.
const apple = () =>
  /mac|iphone|ipad/i.test(
    navigator.userAgentData?.platform || navigator.platform || "",
  );
const modifier = () => (apple() ? "⌘" : "Ctrl");
export const sendKeyLabel = () => `${modifier()} ↵`;
export const sendKeyName = () => (apple() ? "Meta+Enter" : "Control+Enter");
export const sendKey = (event) =>
  event.key === "Enter" &&
  !event.shiftKey &&
  !event.altKey &&
  (apple() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

// What this browser sent that the poll does not show yet, by thread ID.
const sent = new Map();
// The card drawn for each thread on the page on screen.
const cards = new Map();
// What the reviewer typed in each card's Reply field.
const drafts = new Map();
// The agent messages the reviewer opened with Show all.
const opened = new Set();

function allThreads() {
  const byId = new Map((remote?.threads || []).map((item) => [item.id, item]));
  for (const [id, local] of sent) {
    const stored = byId.get(id);
    // The hub's copy replaces this browser's once it has every message.
    if (stored && stored.messages.length >= local.messages.length)
      sent.delete(id);
    else byId.set(id, local);
  }
  return [...byId.values()];
}
async function post(id, url, body) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "The hub refused it.");
    sent.set(id, result.thread);
  } catch (error) {
    sent.set(id, {
      ...sent.get(id),
      error: unreachable(error),
      retry: () => post(id, url, body),
    });
  }
  placeThreads();
}
export function startThread(context, text, attachments) {
  const now = new Date().toISOString();
  const fields = {
    id: uuid(),
    round: plan.round,
    topic: context.topic,
    anchor: context.anchor,
    ...(context.quote ? { quote: context.quote } : {}),
    ...(context.target ? { target: context.target } : {}),
    ...(context.occurrence ? { occurrence: context.occurrence } : {}),
    ...(context.agreementId ? { agreementId: context.agreementId } : {}),
  };
  sent.set(fields.id, {
    ...fields,
    page: pages.find((item) => item.id === context.topic)?.title,
    state: "sending",
    createdAt: now,
    messages: [{ from: "reviewer", at: now, text, attachments }],
  });
  placeThreads();
  void post(fields.id, `${base}/api/threads`, {
    ...fields,
    text,
    attachments,
  });
}
function sendReply(thread, text) {
  const { error, retry, ...rest } = thread;
  sent.set(thread.id, {
    ...rest,
    state: "sending",
    messages: [
      ...thread.messages,
      { from: "reviewer", at: new Date().toISOString(), text },
    ],
  });
  drafts.delete(thread.id);
  placeThreads();
  void post(
    thread.id,
    `${base}/api/threads/${encodeURIComponent(thread.id)}/messages`,
    { text },
  );
}

/* Times */
function when(at) {
  const seconds = Math.round((Date.now() - Date.parse(at)) / 1000);
  if (seconds < 10) return "now";
  return seconds < 60 ? `${seconds}s ago` : ago(at);
}
function lasted(at) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
}
/* Messages */
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
// What Show all opens, such as "code, 30 lines", read from the message
// before its components render.
function contents(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  const parts = [];
  const lines = [...root.querySelectorAll("[data-language]")].reduce(
    (total, block) => total + block.textContent.trim().split("\n").length,
    0,
  );
  if (lines) parts.push(`code, ${plural(lines, "line")}`);
  for (const [selector, name] of [
    ["[data-diff-input]", "a diff"],
    ["[data-diagram]", "a diagram"],
    ["[data-chart]", "a chart"],
    ["[data-math]", "a formula"],
    ["table", "a table"],
    ["[data-prototype]", "a prototype"],
  ])
    if (root.querySelector(selector)) parts.push(name);
  return parts.join(" and ");
}
// A long message opens cut at about twelve lines, under a fade.
const clampHeight = 250;
function agentBody(thread, message, index) {
  const clamp = element("div", "thread-clamp");
  const content = element("div", "thread-content");
  let summary = "";
  if (message.html !== undefined) {
    summary = contents(message.html);
    content.innerHTML = message.html;
  } else content.append(element("p", "thread-text", message.text));
  clamp.append(content);
  const more = element("button", "link-btn thread-more");
  more.type = "button";
  const key = `${thread.id}/${index}`;
  const fit = () => {
    const long = content.scrollHeight > clampHeight + 40;
    const open = opened.has(key);
    more.hidden = !long;
    clamp.classList.toggle("clamped", long && !open);
    more.setAttribute("aria-expanded", String(open));
    const lines = Math.round(
      content.scrollHeight / parseFloat(getComputedStyle(content).lineHeight),
    );
    more.textContent = open
      ? "Show less"
      : `Show all · ${summary || plural(lines, "line")}`;
  };
  more.onclick = () => {
    if (opened.has(key)) opened.delete(key);
    else opened.add(key);
    fit();
  };
  new ResizeObserver(fit).observe(content);
  if (message.html !== undefined) enhance(content);
  return [clamp, more];
}
function images(message) {
  const strip = element("div", "thread-images");
  for (const item of message.attachments || []) {
    const link = element("a");
    link.href = `${base}/api/upload/${encodeURIComponent(item.id)}`;
    link.target = "_blank";
    link.rel = "noopener";
    const image = element("img", "note-image");
    image.src = link.href;
    image.alt = "An image on this message";
    link.append(image);
    strip.append(link);
  }
  return strip;
}
function messageRow(thread, message, index) {
  const agent = message.from === "agent";
  const row = element("div", "thread-message");
  const avatar = element("span", "thread-avatar", agent ? "A" : "Y");
  avatar.classList.toggle("agent", agent);
  avatar.setAttribute("aria-hidden", "true");
  const body = element("div", "thread-body");
  const name = element("p", "thread-name", agent ? "Agent " : "You ");
  const time = element("span", "thread-meta thread-when", when(message.at));
  time.dataset.at = message.at;
  name.append(time);
  body.append(name);
  if (agent) body.append(...agentBody(thread, message, index));
  else {
    body.append(element("p", "thread-text", message.text));
    if (message.attachments?.length) body.append(images(message));
  }
  row.append(avatar, body);
  return row;
}

/* The line under the reviewer's last message */
function statusLine(thread) {
  const box = element("div", "thread-status");
  if (thread.error) {
    const line = element("p", "thread-bad", `Could not send: ${thread.error} `);
    if (editable) {
      const retry = element("button", "link-btn", "Try again");
      retry.type = "button";
      retry.onclick = () => {
        const { error, retry: again, ...rest } = thread;
        sent.set(thread.id, { ...rest });
        placeThreads();
        void again();
      };
      line.append(retry);
    }
    box.append(line);
  } else if (thread.state === "sending")
    box.append(element("p", "thread-meta", "Sending"));
  else if (thread.state === "sent") {
    const line = element("p", "thread-sent");
    const info = element("button", "thread-info", "i");
    info.type = "button";
    info.setAttribute("aria-label", "About Sent to the agent");
    const tip = element(
      "span",
      "thread-tip",
      "The agent reads threads between its steps, so a reply can take a minute while it is busy.",
    );
    tip.id = `thread-tip-${thread.id}`;
    tip.setAttribute("role", "tooltip");
    info.setAttribute("aria-describedby", tip.id);
    line.append(element("span", "thread-meta", "Sent to the agent"), info, tip);
    box.append(line);
  } else if (thread.state === "read") {
    const line = element("p", "thread-working");
    line.dataset.since = thread.readAt;
    line.textContent = `Read · replying for ${lasted(thread.readAt)}`;
    box.append(line);
  } else if (thread.state === "failed") {
    box.append(
      element(
        "p",
        "thread-bad",
        "Could not reach the agent. Give this line to an agent to take the session over:",
      ),
    );
    if (remote?.handoff) {
      const line = element("pre", "", remote.handoff);
      line.dataset.language = "text";
      line.dataset.file = "handoff line";
      box.append(line);
      enhance(box);
    }
  }
  return box;
}

/* The card */
function buildCard(id) {
  const card = element("pair-thread", "thread");
  card.dataset.thread = id;
  // A notification of a reply opens the page at this ID.
  card.id = `thread-${id}`;
  const head = element("div", "thread-head");
  const title = element("span", "thread-title");
  const fold = element("button", "link-btn thread-fold");
  fold.type = "button";
  fold.onclick = () => {
    prefs.set(
      `thread:${id}:collapsed`,
      card.hasAttribute("collapsed") ? "0" : "1",
    );
    placeThreads();
  };
  head.append(title, fold);
  const quote = element("div", "thread-quote");
  const messages = element("div", "thread-messages");
  const form = element("form", "thread-reply");
  const field = element("textarea");
  field.rows = 1;
  field.placeholder = "Reply";
  field.setAttribute("aria-label", "Reply in this thread");
  field.value = drafts.get(id) || "";
  field.oninput = () => drafts.set(id, field.value);
  field.onkeydown = (event) => {
    if (!sendKey(event)) return;
    event.preventDefault();
    form.requestSubmit();
  };
  const send = element("button", "btn");
  send.type = "submit";
  send.setAttribute("aria-keyshortcuts", sendKeyName());
  send.append("Send ", element("kbd", "", sendKeyLabel()));
  form.append(field, send);
  form.onsubmit = (event) => {
    event.preventDefault();
    const text = field.value.trim();
    const thread = allThreads().find((item) => item.id === id);
    if (!text || !thread) return;
    field.value = "";
    sendReply(thread, text);
  };
  card.append(head, quote, messages, element("div", "thread-status"), form);
  return { card, title, fold, quote, messages, form, count: 0, key: "" };
}
// folded is whether the card starts collapsed, which the reviewer's own
// Collapse or Expand overrides.
function drawCard(entry, thread, part, folded) {
  const choice = prefs.get(`thread:${thread.id}:collapsed`);
  const collapsed = choice ? choice === "1" : folded;
  const key = JSON.stringify([
    thread.messages.length,
    thread.state,
    thread.readAt,
    thread.error,
    collapsed,
    part,
    remote?.handoff,
  ]);
  if (key === entry.key) return;
  entry.key = key;
  const { card, title, fold, quote, messages, form } = entry;
  card.toggleAttribute("collapsed", collapsed);
  const head = threadTitle(thread, part, collapsed);
  title.replaceChildren(element("b", "", head.name), ` · ${head.meta}`);
  quote.hidden = !thread.quote;
  quote.replaceChildren("“", element("span", "", normalize(thread.quote)), "”");
  fold.textContent = collapsed ? "Expand" : "Collapse";
  fold.setAttribute("aria-expanded", String(!collapsed));
  // Messages only ever arrive at the end, so the rendered ones stay.
  if (thread.messages.length < entry.count) {
    messages.replaceChildren();
    entry.count = 0;
  }
  for (; entry.count < thread.messages.length; entry.count++)
    messages.append(
      messageRow(thread, thread.messages[entry.count], entry.count),
    );
  card.querySelector(".thread-status").replaceWith(statusLine(thread));
  form.hidden =
    !editable ||
    Boolean(thread.error) ||
    !["replied", "failed"].includes(thread.state);
}
// The block a thread is on: the side-work item its note named, since the
// items share one Side work block, the top-level block that holds its
// target or its quote, or none, which puts the card at the end of the page.
function blockOf(root, thread) {
  const top = (node) => {
    let at = node?.nodeType === 1 ? node : node?.parentElement;
    while (at && at.parentElement !== root) at = at.parentElement;
    return at && at.localName !== "pair-thread" ? at : null;
  };
  const target = thread.target && document.getElementById(thread.target);
  const item = target?.closest("#side-work .agreement-card");
  if (item && root.contains(item)) return item;
  const named = top(target);
  if (named) return named;
  const range = thread.quote && findText(root, thread.quote);
  return (range && top(range.startContainer)) || null;
}
// Each card goes under its block, after the cards started there before it.
// With four or more threads on one block, all but the two newest start
// collapsed.
export function placeThreads() {
  const root = $("page-content");
  if (!page || page.pending || $("reading").hidden) return;
  const list = allThreads()
    .filter((item) => item.round === plan.round && item.topic === page.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ids = new Set(list.map((item) => item.id));
  for (const card of root.querySelectorAll("pair-thread"))
    if (!ids.has(card.dataset.thread)) card.remove();
  const groups = new Map();
  for (const thread of list) {
    const block = blockOf(root, thread);
    groups.set(block, [...(groups.get(block) || []), thread]);
  }
  const placed = new Set();
  for (const [block, threads] of groups)
    threads.forEach((thread, index) => {
      if (!cards.has(thread.id)) cards.set(thread.id, buildCard(thread.id));
      const entry = cards.get(thread.id);
      const folded = threads.length >= 4 && index < threads.length - 2;
      drawCard(entry, thread, partOf(block, thread), folded);
      let after =
        block ||
        [...root.children]
          .filter((node) => node.localName !== "pair-thread")
          .at(-1);
      if (!after) {
        if (entry.card.parentElement !== root) root.append(entry.card);
      } else {
        while (placed.has(after.nextElementSibling))
          after = after.nextElementSibling;
        if (after.nextElementSibling !== entry.card) after.after(entry.card);
      }
      placed.add(entry.card);
    });
}
// The times on the cards on screen count up between polls.
function tick() {
  for (const { card } of cards.values()) {
    if (!card.isConnected) continue;
    for (const time of card.querySelectorAll("[data-at]"))
      time.textContent = when(time.dataset.at);
    const working = card.querySelector("[data-since]");
    if (working)
      working.textContent = `Read · replying for ${lasted(working.dataset.since)}`;
  }
}
export function installThreads() {
  for (const key of document.querySelectorAll("[data-send-key]"))
    key.textContent = sendKeyLabel();
  for (const key of document.querySelectorAll("[data-send-modifier]"))
    key.textContent = modifier();
  // A page render replaces the page's content, so its cards are drawn anew.
  window.addEventListener("plan:page", () => {
    cards.clear();
    placeThreads();
  });
  setInterval(tick, 1000);
}
