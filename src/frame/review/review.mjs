import { callHook } from "#frame/app/hooks.mjs";
import {
  displayedRound,
  lastSubmission,
  listedTab,
  refusedMessage,
  selectedTab,
  sentByRound,
  submissionError,
} from "#frame/app/state.mjs";
import {
  draftedWords,
  emptyDraft,
  save,
  state,
  unsentItems,
} from "#frame/app/store.mjs";
import { badge, tag } from "#frame/app/ui.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  base,
  current,
  currentAvailable,
  editable,
  isPlanRound,
  mode,
  page,
  pages,
  plan,
  showingWaiting,
  submittedRound,
  viewKey,
} from "#frame/app/view.mjs";
import { commentTarget } from "#frame/notes/blocks.mjs";
import { restoreAnswers, restoreChoices } from "#frame/notes/controls.mjs";
import { forgetImages } from "#frame/notes/images.mjs";
import { known, stale } from "#frame/notes/known.mjs";
import { openNote } from "#frame/notes/notes.mjs";
import { choiceLabel, submitButton } from "#frame/review/send-choices.mjs";
import {
  sendAccepts,
  sendState,
  settleSend,
} from "#frame/review/send-state.mjs";
import { renderActivity, renderHistory } from "#frame/sync/activity-view.mjs";
import { choiceText } from "#shared/choices.mjs";

let renderedFeedback = null;
export function setRenderedFeedback(value) {
  renderedFeedback = value;
}

function contextLink(topic, target, text = "View") {
  const link = document.createElement("a");
  link.className = "context-link";
  link.href = `${target ? "?target=" + encodeURIComponent(target) : ""}#${encodeURIComponent(topic)}`;
  link.textContent = text;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    callHook("show", topic, target);
  });
  return link;
}

function summaryText(kind, item, drawing) {
  if (kind === "choice" || kind === "list") return choiceText(item);
  if (kind === "answer" && item.kind === "drawing") return drawing?.(item);
  return item.text;
}

// itemSummary uses the caller's label only when the item has none, and the
// caller's drawing function for the text of a drawing answer.
export function itemSummary(kind, item, { label, drawing } = {}) {
  const own = kind === "note" ? item.anchor : item.label;
  return {
    label: label === undefined ? own : own || label,
    text: summaryText(kind, item, drawing),
  };
}

function appendItemMedia(body, { kind, item, summary }) {
  if (kind === "note" && item.quote) {
    const quote = document.createElement("blockquote");
    quote.textContent = item.quote;
    body.append(quote);
  }
  if (kind === "answer" && item.kind === "drawing") {
    const image = document.createElement("img");
    image.className = "drawing-preview";
    image.src = `${base}/api/upload/${encodeURIComponent(item.previewId)}`;
    image.alt = `Drawing answer: ${item.label}`;
    body.append(image);
  } else {
    const text = document.createElement("p");
    text.textContent = summary.text;
    body.append(text);
  }
  /* The thumbnails load from the hub, which stores the uploaded files, so
     the reviewer sees the same image that the agent opens. */
  if (kind === "note" && item.attachments?.length) {
    const strip = document.createElement("div");
    strip.className = "note-images";
    for (const image of item.attachments) {
      const thumb = document.createElement("img");
      thumb.src = `${base}/api/upload/${encodeURIComponent(image.id)}`;
      thumb.alt = "";
      thumb.className = "note-image";
      strip.append(thumb);
    }
    body.append(strip);
  }
}

function appendAction(actions, label, onclick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn quiet";
  button.textContent = label;
  button.addEventListener("click", onclick);
  actions.append(button);
}

function appendItemActions(actions, { kind, key, item }) {
  if (item.sentIn) return;
  if (kind === "note") {
    appendAction(actions, "Edit", () => openNote(item));
    appendAction(actions, "Remove", () => {
      forgetImages(item.attachments);
      state.notes = state.notes.filter((note) => note.id !== item.id);
      save();
      // show() opens the page, so the handler calls it only when the
      // note's page is already on screen, and Review stays open.
      if (item.topic === page.id && !$("reading").hidden) {
        callHook("show", page.id, null, { keepScroll: true });
      }
    });
  } else if (kind === "choice") {
    appendAction(actions, "Add comment", () =>
      openNote({
        topic: item.topic,
        anchor: item.label,
        quote: choiceText(item),
        target: item.target,
      }),
    );
    appendAction(actions, "Clear choice", () => {
      delete state.choices[key];
      restoreChoices();
      save();
    });
  } else if (kind === "answer") {
    appendAction(actions, "Remove", () => {
      delete state.answers[key];
      restoreAnswers();
      save();
    });
  }
}

function itemHeading({ kind, key, item, summary }) {
  const title = document.createElement("h3");
  title.textContent =
    kind === "answer" ? `Answer · ${summary.label}` : summary.label;
  // A note with no anchor has no heading, and an empty h3 would leave a
  // blank line above the note's text.
  title.hidden = kind === "note" && !item.anchor;
  if (item.sentIn) title.append(tag("Sent", "ok"));
  const old = stale(kind, key, item);
  if (old && item.round && item.round !== plan.round) {
    title.append(tag(`from round ${item.round}`, "muted"));
  }
  return title;
}

function itemCard({ kind, key, item }) {
  const summary = itemSummary(kind, item);
  const box = document.createElement("div");
  box.className = "feedback-item" + (item.sentIn ? " sent" : "");
  // The ID is the same on every draw, so the note dialog's close handler can
  // return focus to the redrawn item.
  box.id = `feedback-${kind}-${key}`;
  const body = document.createElement("div");
  body.append(itemHeading({ kind, key, item, summary }));
  appendItemMedia(body, { kind, item, summary });
  const topicExists = item.topic === "agreed" || known.text.has(item.topic);
  if (item.topic !== "overall" && topicExists) {
    body.append(
      contextLink(
        item.topic,
        item.target,
        kind === "note" ? "View" : "Edit on the page",
      ),
    );
  }
  box.append(body);
  const actions = document.createElement("div");
  actions.className = "feedback-item-actions";
  appendItemActions(actions, { kind, key, item });
  box.append(actions);
  return box;
}

function renderFeedback() {
  // A checklist that the reviewer never touched is not feedback, so
  // renderFeedback lists it only after a round has sent it.
  const items = [
    ...Object.entries(state.choices)
      .filter(
        ([, item]) => item.kind !== "multiple" || item.touched || item.sentIn,
      )
      .map(([key, item]) => ({
        kind: item.kind === "multiple" ? "list" : "choice",
        key,
        item,
        topic: item.topic,
      })),
    ...Object.entries(state.answers).map(([key, item]) => ({
      kind: "answer",
      key,
      item,
      topic: item.topic,
    })),
    ...state.notes.map((item) => ({
      kind: "note",
      key: item.id,
      item,
      topic: item.topic,
    })),
  ];
  const groups = $("feedback-groups");
  groups.replaceChildren();
  const group = (heading, entries) => {
    if (!entries.length) return;
    const section = document.createElement("section");
    section.className = "feedback-group";
    const head = document.createElement("div");
    head.className = "group-head";
    const title = document.createElement("h2");
    title.textContent = heading;
    head.append(title);
    section.append(head, ...entries.map(itemCard));
    groups.append(section);
  };
  for (const topic of pages) {
    group(
      topic.title,
      items.filter((entry) => entry.topic === topic.id),
    );
  }
  const orphans = items.filter(
    (entry) =>
      !["overall", "work"].includes(entry.topic) &&
      !pages.some((p) => p.id === entry.topic),
  );
  for (const round of new Set(orphans.map((entry) => entry.item.round))) {
    group(
      round ? `From round ${round}` : "From an earlier round",
      orphans.filter((entry) => entry.item.round === round),
    );
  }
  group(
    "Work",
    items.filter((entry) => entry.topic === "work"),
  );
  const overall = items.filter((entry) => entry.topic === "overall");
  $("overall-group").hidden = !overall.length;
  $("overall-notes").replaceChildren(...overall.map(itemCard));
}

export function sentEntries(submission) {
  if (!submission) return [];
  const groups = submission.groups || {};
  return [
    ...(groups.notes || []).map((note) =>
      Object.assign(
        { topic: note.topic },
        itemSummary("note", note, { label: "Comment" }),
        {
          id: note.id,
          quote: note.quote,
          images: (note.attachments || []).map((item) => item.id),
        },
      ),
    ),
    ...Object.entries(groups.choices || {}).map(([id, choice]) =>
      Object.assign(
        { topic: choice.topic },
        itemSummary("choice", choice, { label: "Choice" }),
        { id },
      ),
    ),
    ...Object.entries(groups.answers || {}).map(([id, answer]) =>
      Object.assign(
        { topic: answer.topic },
        itemSummary("answer", answer, {
          label: "Answer",
          drawing: () => "Drawing attached",
        }),
        {
          images: answer.kind === "drawing" ? [answer.previewId] : [],
          id,
        },
      ),
    ),
  ];
}

// A submission from before the Send popup has neither next nor message.
function sentChoice(submission) {
  const label = choiceLabel(submission.next, isPlanRound());
  return [
    ...(label ? [{ heading: "What comes next", text: label }] : []),
    ...(submission.message
      ? [
          {
            id: submission.id,
            heading: "Message to the agent",
            text: submission.message,
          },
        ]
      : []),
  ];
}

function sentEntryWhere(topic) {
  return (
    pages.find((item) => item.id === topic)?.title ||
    { overall: "Overall", work: "Work" }[topic] ||
    topic ||
    "Overall"
  );
}

function sentImagesStrip(imageIds) {
  const images = document.createElement("div");
  images.className = "sent-images";
  for (const id of imageIds) {
    const link = document.createElement("a");
    link.href = `${base}/api/upload/${encodeURIComponent(id)}`;
    link.target = "_blank";
    link.rel = "noopener";
    const thumbnail = document.createElement("img");
    thumbnail.src = link.href;
    thumbnail.alt = "Attached image";
    thumbnail.loading = "lazy";
    link.append(thumbnail);
    images.append(link);
  }
  return images;
}

export function sentCard(entry) {
  const card = document.createElement("div");
  card.className = "sent-card";
  const where = sentEntryWhere(entry.topic);
  const label = document.createElement("small");
  label.textContent =
    entry.heading ??
    (entry.label === where ? where : `${where} · ${entry.label}`);
  const body = document.createElement("p");
  body.textContent = entry.text;
  card.append(label);
  if (entry.quote) {
    const quote = document.createElement("blockquote");
    quote.textContent = entry.quote;
    card.append(quote);
  }
  card.append(body);
  if (entry.images?.length) card.append(sentImagesStrip(entry.images));
  return card;
}

export function renderSentPageComments() {
  const section = $("sent-page-comments");
  section.replaceChildren();
  const sent = showingWaiting() ? null : shownSubmission();
  const entries = sent
    ? sentEntries(sent).filter((entry) => entry.topic === page.id)
    : [];
  section.hidden = !entries.length;
  if (!entries.length) return;
  const heading = document.createElement("h2");
  heading.textContent = "Your sent comments";
  section.append(heading, ...entries.map(sentCard));
}

function mutedLine(text) {
  const line = document.createElement("p");
  line.className = "muted";
  line.textContent = text;
  return line;
}

function populateSentList(list, sent) {
  const entries = sentEntries(sent);
  for (const entry of [...sentChoice(sent), ...entries]) {
    const card = sentCard(entry);
    // A search result in sent feedback opens at this card. The same card on its
    // page has no ID, so the ID stays unique.
    if (entry.id) card.id = `sent-${entry.id}`;
    list.append(card);
  }
  if (!entries.length) {
    list.append(
      mutedLine(
        sent.groups.alignUnflagged
          ? "Everything else looked good."
          : "No comments were sent.",
      ),
    );
  }
}

let renderedSentKey = null;
export function renderSentFeedback() {
  const sent = shownSubmission();
  // A past round's submission may still be loading, so renderSentFeedback
  // says that no feedback was sent only after the submission has loaded.
  const loaded = mode === "readonly" || sentByRound.has(plan.round);
  // sentCard names each place from the view's pages, and the waiting view has
  // the sent round's number but none of its pages, so the key names the view.
  const key = `${viewKey()}:${sent?.id || (loaded ? "none" : "")}`;
  if (renderedSentKey === key) return;
  renderedSentKey = key;
  const list = $("sent-feedback-list");
  list.replaceChildren();
  if (!sent) {
    if (loaded) list.append(mutedLine("Nothing was sent on this round."));
    return;
  }
  populateSentList(list, sent);
  renderSentPageComments();
}

// The status poll updates lastSubmission, and sentByRound contains each
// submission fetched for an older round.
export function shownSubmission() {
  if (mode === "readonly" || lastSubmission?.round === plan.round) {
    return lastSubmission;
  }
  return sentByRound.get(plan.round) || null;
}

// The frame shows a past round's controls as they were sent, so showSent
// fills the draft from that round's submission.
export function showSent(draft, submission) {
  draft.choices = submission?.groups?.choices || {};
  draft.answers = submission?.groups?.answers || {};
}

export function sentDraft(round) {
  const draft = emptyDraft(round);
  showSent(
    draft,
    lastSubmission?.round === round ? lastSubmission : sentByRound.get(round),
  );
  return draft;
}

function listedBadgeCount(listedSent, locked, unsent) {
  if (listedTab === selectedTab) return locked ? 0 : unsent.count;
  if (listedSent) return 0;
  return unsentItems(callHook("currentDraft")).count;
}

function feedbackHeading(sent, send) {
  if (sent) return "What you sent";
  return send === "sending" ? "Sending" : "Review";
}

function lockPageControls() {
  $("page-content")
    .querySelectorAll(
      "[data-choice] [data-value], [data-multiselect] input, [data-question] textarea, [data-answer], [data-edit], [data-drawing-question] [data-draw], [data-comment]",
    )
    .forEach((control) => {
      if (control.tagName === "TEXTAREA") control.readOnly = true;
      else control.disabled = true;
    });
}

function updateSubmitControl(send, sent, unsent) {
  // The header button always applies to Current. On a past round the frame
  // sends Current's draft, and after Current's round is sent the frame opens
  // that round's What you sent.
  const forCurrent = selectedTab === "past" && currentAvailable();
  const draft = forCurrent ? callHook("currentDraft") : state;
  const pending = forCurrent ? unsentItems(draft) : unsent;
  const button = submitButton({
    inFlight: send === "sending",
    opensFeedback: sent && !forCurrent,
    onSentFeedback:
      $("reading").hidden &&
      (mode === "readonly" || plan.round === submittedRound),
    waitingForPages: send === "pages-pending",
    sendable: sendAccepts("send", send) && (forCurrent || current()),
    pending: pending.count,
  });
  $("submit").disabled = button.disabled;
  $("submit").textContent = button.text;
  $("submit").classList.toggle("primary", button.primary);
}

function syncReviewBanners() {
  $("submit-error").hidden = !submissionError;
  $("submit-error").textContent = submissionError;
  $("save-error").hidden = !submissionError || $("reading").hidden;
  $("save-error-text").textContent = submissionError;
  $("save-error-message").hidden = !refusedMessage;
}

function syncReviewRow(listedSent, locked, unsent) {
  badge(listedBadgeCount(listedSent, locked, unsent));
  const reviewLabel = $("review-row")?.querySelector("span");
  if (reviewLabel) {
    reviewLabel.textContent = listedSent ? "What you sent" : "Review";
  }
}

export function review() {
  settleSend();
  if (displayedRound !== viewKey()) {
    renderHistory();
    callHook("status");
    return;
  }
  const unsent = unsentItems(state);
  const send = sendState();
  const sent = selectedTab === "past" || mode === "readonly";
  const locked = sent || (editable && !sendAccepts("edit", send));
  $("draft-head").hidden = unsent.count === 0;
  $("draft-count").textContent = `${draftedWords(state)} to send`;
  // The sidebar's last row shows the round that the sidebar lists, and
  // after a tab click that can be the other tab's round.
  syncReviewRow(listedTab === "past" || mode === "readonly", locked, unsent);
  $("feedback-title").textContent = feedbackHeading(sent, send);
  $("feedback-review").hidden = locked;
  renderActivity();
  renderHistory();
  syncReviewBanners();
  if (locked) lockPageControls();
  commentTarget();
  callHook("renderFooter", !$("review-view").hidden);
  const rendered = JSON.stringify([
    state.notes,
    state.choices,
    state.answers,
    state.submitted,
  ]);
  if (renderedFeedback !== rendered) {
    renderFeedback();
    renderedFeedback = rendered;
  }
  updateSubmitControl(send, sent, unsent);
  callHook("status");
}
