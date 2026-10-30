import { enhance } from "#frame/app/registry.mjs";
import { prefs } from "#frame/app/store.mjs";
import { ago } from "#frame/app/time.mjs";
import { $, normalize, plural, unreachable, uuid } from "#frame/app/util.mjs";
import {
  base,
  editable,
  page,
  plan,
  shownPage,
  topicTitle,
} from "#frame/app/view.mjs";
import { findText, placeMarks } from "#frame/notes/notes.mjs";
import { ackButton, syncAcks } from "#frame/notes/thread-ack.mjs";
import { partOf, threadTitle } from "#frame/notes/thread-head.mjs";
import { replyForm } from "#frame/notes/thread-reply.mjs";
import {
  diffForTarget,
  diffViews,
  setDiffThreads,
} from "#frame/pages/renderers.mjs";
import { clearThread } from "#frame/sync/center.mjs";
import { messageTiming } from "#frame/sync/activity.mjs";
import { remote, selectedTab } from "#frame/sync/rounds.mjs";

/* The hub stores every thread, and each status poll returns all of them.
   placeThreads draws the cards from the poll, and from sent for a message
   that this browser sent and the poll does not show yet. */

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

// sent maps a thread ID to a thread that this browser sent and the hub's
// poll does not show yet.
const sent = new Map();
const cards = new Map();
// opened contains the "threadId/index" key of each agent message that the
// reviewer expanded with Show all.
const opened = new Set();

function allThreads() {
  const byId = new Map((remote?.threads || []).map((item) => [item.id, item]));
  for (const [id, local] of sent) {
    const stored = byId.get(id);
    if (!stored || stored.messages.length < local.messages.length) {
      byId.set(id, local);
      continue;
    }
    // allThreads uses the hub's copy once it contains every message that this
    // browser sent. An agent reply can bring the hub's copy to the same length
    // without the reviewer's reply, so allThreads compares the reply IDs.
    const unsent = local.messages.filter(
      ({ replyId }) =>
        replyId && !stored.messages.some((item) => item.replyId === replyId),
    );
    if (unsent.length)
      byId.set(id, { ...local, messages: [...stored.messages, ...unsent] });
    else sent.delete(id);
  }
  return [...byId.values()];
}
// post calls saved once the hub has the message, after a retry too.
async function post(id, url, body, saved) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "The hub refused it.");
    // When the reviewer sent another reply after this one, sent keeps the
    // longer local copy until the hub answers that reply.
    if (result.thread.messages.length >= (sent.get(id)?.messages.length ?? 0))
      sent.set(id, result.thread);
    saved?.();
  } catch (error) {
    sent.set(id, {
      ...sent.get(id),
      error: unreachable(error),
      retry: () => post(id, url, body, saved),
    });
  }
  placeThreads();
}
export function startThread(context, text, attachments, saved) {
  const now = new Date().toISOString();
  const fields = context.proposal
    ? { id: uuid(), proposal: context.proposal }
    : {
        id: uuid(),
        round: plan.round,
        topic: context.topic,
        anchor: context.anchor,
        ...(context.quote ? { quote: context.quote } : {}),
        ...(context.target ? { target: context.target } : {}),
        ...(context.occurrence ? { occurrence: context.occurrence } : {}),
        ...(context.diffLine ? { diffLine: context.diffLine } : {}),
        ...(context.diagramNode ? { diagramNode: context.diagramNode } : {}),
        ...(context.agreementId ? { agreementId: context.agreementId } : {}),
      };
  sent.set(fields.id, {
    ...fields,
    page: context.proposal ? context.anchor : topicTitle(context.topic),
    state: "sending",
    createdAt: now,
    messages: [{ from: "reviewer", at: now, text, attachments }],
  });
  placeThreads();
  void post(
    fields.id,
    `${base}/api/threads`,
    {
      ...fields,
      text,
      attachments,
    },
    saved,
  );
}
function sendReply(thread, text, attachments) {
  const { error, retry, ...rest } = thread;
  const replyId = uuid();
  const at = new Date().toISOString();
  sent.set(thread.id, {
    ...rest,
    state: "sending",
    messages: [
      ...thread.messages,
      { from: "reviewer", at, replyId, text, attachments },
    ],
  });
  // A reply answers the agent's replies in the thread, so clearThread
  // removes them from the bell before the hub responds.
  clearThread(thread.id);
  placeThreads();
  void post(
    thread.id,
    `${base}/api/threads/${encodeURIComponent(thread.id)}/messages`,
    { replyId, text, attachments },
  );
}

function when(at) {
  const seconds = Math.round((Date.now() - Date.parse(at)) / 1000);
  if (seconds < 10) return "now";
  return seconds < 60 ? `${seconds}s ago` : ago(at);
}
function lasted(at) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
}
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
// contents describes what Show all reveals, such as "code, 30 lines". It
// reads the message's HTML before the components render it.
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
    ["video", "a video"],
  ])
    if (root.querySelector(selector)) parts.push(name);
  return parts.join(" and ");
}
// clampHeight matches the max-height of .thread-clamp.clamped in
// threads.css.
const clampHeight = 250;
const fits = new WeakMap();
const unfitted = new Set();
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
  fits.set(clamp, fit);
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
  // The frame opens the page at this ID for a reply's notification. The hub
  // only appends messages, so an index always names the same message.
  row.id = `thread-${thread.id}-${index}`;
  const avatar = element("span", "thread-avatar", agent ? "A" : "Y");
  avatar.classList.toggle("agent", agent);
  avatar.setAttribute("aria-hidden", "true");
  const body = element("div", "thread-body");
  const name = element("p", "thread-name", agent ? "Agent " : "You ");
  const time = element("span", "thread-meta thread-when", when(message.at));
  time.dataset.at = message.at;
  name.append(time);
  if (agent) name.prepend(ackButton(thread, index));
  body.append(name);
  if (agent) body.append(...agentBody(thread, message, index));
  else {
    body.append(element("p", "thread-text", message.text));
    if (message.attachments?.length) body.append(images(message));
  }
  row.append(avatar, body);
  return row;
}

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
    const tip = element("span", "thread-tip", messageTiming(remote?.holder));
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

function buildCard(id) {
  const card = element("pair-thread", "thread");
  card.dataset.thread = id;
  // The frame opens the page at this ID for an older reply notification
  // that has no message index.
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
  const form = replyForm(id, (text, attachments) => {
    const thread = allThreads().find((item) => item.id === id);
    if (!thread) return false;
    sendReply(thread, text, attachments);
  });
  card.append(head, quote, messages, element("div", "thread-status"), form);
  return { card, title, fold, quote, messages, form, shown: [], key: "" };
}
// folded is whether the card starts collapsed. The reviewer's own Collapse
// or Expand, which prefs stores, overrides it.
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
  syncAcks(entry.messages, thread);
  if (key === entry.key) return;
  entry.key = key;
  unfitted.add(entry.card);
  const { card, title, fold, quote, messages, form } = entry;
  card.toggleAttribute("collapsed", collapsed);
  const head = threadTitle(thread, part, collapsed);
  title.replaceChildren(element("b", "", head.name), ` · ${head.meta}`);
  quote.hidden = !thread.quote;
  quote.replaceChildren("“", element("span", "", normalize(thread.quote)), "”");
  fold.textContent = collapsed ? "Expand" : "Collapse";
  fold.setAttribute("aria-expanded", String(!collapsed));
  // The hub only appends messages, so drawCard keeps the rendered rows. The
  // exception is an agent reply that reached the hub before a reply that
  // this card showed at once. The hub then lists the agent's reply first,
  // so drawCard draws every row again.
  const shown = (message) =>
    message && `${message.from}\n${message.text ?? message.html}`;
  if (
    entry.shown.some((item, index) => item !== shown(thread.messages[index]))
  ) {
    messages.replaceChildren();
    entry.shown = [];
  }
  while (entry.shown.length < thread.messages.length) {
    const index = entry.shown.length;
    messages.append(messageRow(thread, thread.messages[index], index));
    entry.shown.push(shown(thread.messages[index]));
  }
  card.querySelector(".thread-status").replaceWith(statusLine(thread));
  form.hidden = !editable || Boolean(thread.error);
}
// blockOf returns the Agreed card or top-level block that contains the
// thread's target or quote. When it returns null, placeThreads puts the card
// at the end of the page.
function blockOf(root, thread) {
  const top = (node) => {
    let at = node?.nodeType === 1 ? node : node?.parentElement;
    while (
      at &&
      at.parentElement !== root &&
      !at.classList.contains("agreement-card")
    )
      at = at.parentElement;
    return at && at.localName !== "pair-thread" ? at : null;
  };
  const target = thread.target && document.getElementById(thread.target);
  const named = top(target);
  if (named) return named;
  const range = thread.quote && findText(root, thread.quote);
  return (range && top(range.startContainer)) || null;
}
const onProgress = (thread) =>
  thread.topic === "agreed" && thread.target === "agent-activity";
// sentWhileWaiting is true for a thread that the reviewer started from the
// progress card after sending a round's feedback. The hub records the sent
// round on the thread, but the card then shows the agent's work on the next
// round, so the frame draws the thread on Current's Agreed. After the next
// send, roundStartedAt is later than the thread, and the frame draws the thread
// under its recorded round.
const sentWhileWaiting = (thread) =>
  editable &&
  onProgress(thread) &&
  thread.round === remote?.latestSubmissionRound &&
  thread.createdAt >= remote.roundStartedAt;
// onCurrentAgreed is true when target, from the bell or a link, is in a thread
// that shows on Current's Agreed instead of under its recorded round.
export const onCurrentAgreed = (target) =>
  (remote?.threads || []).some(
    (thread) =>
      sentWhileWaiting(thread) &&
      (target === `thread-${thread.id}` ||
        target?.startsWith(`thread-${thread.id}-`)),
  );
// A page with page.pending set has no content to put a thread under. The
// waiting Agreed is one of those, and it still has the progress card.
const onShownPage = (thread) =>
  sentWhileWaiting(thread)
    ? selectedTab === "current" &&
      plan.round === remote.current?.round &&
      page.id === "agreed"
    : !page.pending && thread.round === plan.round && thread.topic === page.id;
// placeProgress puts the threads after the finished line, which is hidden while
// the progress card shows. A thread's card therefore does not move when the
// progress card hides, and its reply box keeps focus.
function placeProgress(threads) {
  const live = !$("agent-activity").hidden;
  let after = $("finished-line");
  let moved = false;
  for (const thread of threads) {
    if (!cards.has(thread.id)) cards.set(thread.id, buildCard(thread.id));
    const entry = cards.get(thread.id);
    // When the round finishes, drawCard would collapse the card and hide the
    // reply box that the reviewer is typing in, so placeProgress records an
    // Expand.
    if (!live && entry.form.contains(document.activeElement))
      prefs.set(`thread:${thread.id}:collapsed`, "0");
    drawCard(entry, thread, null, !live);
    if (after.nextElementSibling !== entry.card) {
      after.after(entry.card);
      moved = true;
    }
    after = entry.card;
  }
  // The progress cards are above the page's content, so moving one moves the
  // blocks under the note bars.
  if (moved) placeMarks();
}
const cardOf = (id) =>
  [
    ...document.querySelectorAll(`[data-proposal-card="${CSS.escape(id)}"]`),
  ].find((node) => !node.closest("[hidden]"));
function endOf(thread) {
  if (thread.topic === "work" && shownPage() === "work")
    return $("work-threads");
  if (
    thread.topic === "overall" &&
    shownPage() === "feedback" &&
    thread.round === plan.round
  )
    return $("overall-threads");
  return null;
}
const folds = (threads, index) =>
  threads.length >= 4 && index < threads.length - 2;
function placeEnds(threads) {
  for (const box of [$("overall-threads"), $("work-threads")]) {
    const listed = threads.filter((thread) => endOf(thread) === box);
    listed.forEach((thread, index) => {
      if (!cards.has(thread.id)) cards.set(thread.id, buildCard(thread.id));
      const entry = cards.get(thread.id);
      drawCard(entry, thread, null, folds(listed, index));
      if (box.children[index] !== entry.card)
        box.insertBefore(entry.card, box.children[index] ?? null);
    });
    for (const card of [...box.children].slice(listed.length)) card.remove();
  }
}
export function placeThreads() {
  const root = $("page-content");
  const reading = page && !$("reading").hidden;
  const groups = new Map();
  const diffGroups = new Map();
  const group = (at, thread) =>
    groups.set(at, [...(groups.get(at) || []), thread]);
  const groupOnDiff = (at, thread) =>
    diffGroups.set(at, [...(diffGroups.get(at) || []), thread]);
  const ids = new Set();
  const list = [];
  const ends = [];
  for (const thread of allThreads().sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    const host = thread.proposal && cardOf(thread.proposal);
    if (host) group(host, thread);
    else if (thread.proposal) cards.get(thread.id)?.card.remove();
    else if (endOf(thread)) ends.push(thread);
    else if (reading && onShownPage(thread)) list.push(thread);
    if (host || list.at(-1) === thread) ids.add(thread.id);
  }
  placeEnds(ends);
  if (reading) {
    for (const card of $("reading").querySelectorAll("pair-thread"))
      if (!ids.has(card.dataset.thread)) card.remove();
    placeProgress(list.filter(onProgress));
    for (const thread of list.filter((item) => !onProgress(item))) {
      const diff = thread.diffLine && diffForTarget(thread.target);
      if (diff) groupOnDiff(diff, thread);
      else group(blockOf(root, thread), thread);
    }
  }
  const placed = new Set();
  for (const [block, threads] of groups)
    threads.forEach((thread, index) => {
      if (!cards.has(thread.id)) cards.set(thread.id, buildCard(thread.id));
      const entry = cards.get(thread.id);
      drawCard(entry, thread, partOf(block, thread), folds(threads, index));
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
  for (const element of diffViews(root)) {
    const threads = diffGroups.get(element) || [];
    const byLine = new Map();
    for (const thread of threads) {
      const key = `${thread.diffLine.side}/${thread.diffLine.lineNumber}`;
      byLine.set(key, [...(byLine.get(key) || []), thread]);
    }
    for (const lineThreads of byLine.values())
      lineThreads.forEach((thread, index) => {
        if (!cards.has(thread.id)) cards.set(thread.id, buildCard(thread.id));
        drawCard(
          cards.get(thread.id),
          thread,
          `line ${thread.diffLine.lineNumber}`,
          folds(lineThreads, index),
        );
      });
    setDiffThreads(element, threads, cards);
  }
  // A message's ResizeObserver calls fit only at the next frame, after a
  // scroll to a reply has measured each long message at its full height.
  // placeThreads therefore calls fit for each card drawn here as soon as the
  // card is on the page.
  for (const card of unfitted)
    if (card.isConnected)
      for (const clamp of card.querySelectorAll(".thread-clamp"))
        fits.get(clamp)();
  unfitted.clear();
}
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
  // A page render replaces #page-content, so the frame draws its cards anew.
  // The progress cards are outside #page-content, and the render leaves them
  // in place, so the reply box the reviewer is typing in keeps its focus when
  // the next round's Agreed arrives.
  window.addEventListener("plan:page", () => {
    for (const [id, { card }] of cards) {
      if (card.parentElement === $("reading")) continue;
      card.remove();
      cards.delete(id);
    }
    placeThreads();
  });
  window.addEventListener("plan:diff", placeThreads);
  setInterval(tick, 1000);
}
