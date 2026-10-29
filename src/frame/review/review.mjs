import {
  draftedWords,
  emptyDraft,
  save,
  state,
  unsentItems,
} from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  base,
  current,
  currentAvailable,
  feedbackEditable,
  isPlanRound,
  mode,
  page,
  pages,
  plan,
  showingWaiting,
  submittedCurrent,
  submittedRound,
  viewKey,
} from "#frame/app/view.mjs";
import { commentTarget } from "#frame/notes/blocks.mjs";
import { restoreAnswers, restoreChoices } from "#frame/notes/controls.mjs";
import { forgetImages } from "#frame/notes/images.mjs";
import { known, openNote, stale } from "#frame/notes/notes.mjs";
import { tag } from "#frame/pages/agreed.mjs";
import {
  badge,
  displayedRound,
  renderFooter,
  show,
} from "#frame/pages/pages.mjs";
import {
  submissionError,
  submissionInFlight,
  submitButton,
} from "#frame/review/send.mjs";
import { choiceLabel } from "#frame/review/send-popup.mjs";
import { renderActivity, renderHistory } from "#frame/sync/activity-view.mjs";
import {
  connected,
  currentDraft,
  lastSubmission,
  listedTab,
  remote,
  selectedTab,
  sentByRound,
} from "#frame/sync/rounds.mjs";
import { status } from "#frame/sync/sessions.mjs";
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
  link.onclick = (event) => {
    event.preventDefault();
    show(topic, target);
  };
  return link;
}
// itemSummary uses the caller's label only when the item has none, and the
// caller's drawing function for the text of a drawing answer.
export function itemSummary(kind, item, { label, drawing } = {}) {
  const own = kind === "note" ? item.anchor : item.label;
  return {
    label: label === undefined ? own : own || label,
    text:
      kind === "choice" || kind === "list"
        ? choiceText(item)
        : kind === "answer" && item.kind === "drawing"
          ? drawing?.(item)
          : item.text,
  };
}
function itemCard({ kind, key, item }) {
  const summary = itemSummary(kind, item);
  const box = document.createElement("div");
  box.className = "feedback-item" + (item.sentIn ? " sent" : "");
  // The ID is the same on every draw, so the note dialog's close handler can
  // return focus to the redrawn item.
  box.id = `feedback-${kind}-${key}`;
  const body = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent =
    kind === "answer" ? `Answer · ${summary.label}` : summary.label;
  // A note with no anchor has no heading, and an empty h3 would leave a
  // blank line above the note's text.
  title.hidden = kind === "note" && !item.anchor;
  if (item.sentIn) title.append(tag("Sent", "ok"));
  const old = stale(kind, key, item);
  if (old && item.round && item.round !== plan.round)
    title.append(tag(`from round ${item.round}`, "muted"));
  body.append(title);
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
  const topicExists =
    item.topic === "agreed" ? true : known.text.has(item.topic);
  if (item.topic !== "overall" && topicExists)
    body.append(
      contextLink(
        item.topic,
        item.target,
        kind === "note" ? "View" : "Edit on the page",
      ),
    );
  box.append(body);
  const actions = document.createElement("div");
  actions.className = "feedback-item-actions";
  const action = (label, onclick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn quiet";
    button.textContent = label;
    button.onclick = onclick;
    actions.append(button);
  };
  if (!item.sentIn) {
    if (kind === "note") {
      action("Edit", () => openNote(item));
      action("Remove", () => {
        forgetImages(item.attachments);
        state.notes = state.notes.filter((note) => note.id !== item.id);
        save();
        // show() opens the page, so the handler calls it only when the
        // note's page is already on screen, and Review stays open.
        if (item.topic === page.id && !$("reading").hidden)
          show(page.id, null, { keepScroll: true });
      });
    } else if (kind === "choice") {
      action("Add comment", () =>
        openNote({
          topic: item.topic,
          anchor: item.label,
          quote: choiceText(item),
          target: item.target,
        }),
      );
      action("Clear choice", () => {
        delete state.choices[key];
        restoreChoices();
        save();
      });
    } else if (kind === "answer") {
      action("Remove", () => {
        delete state.answers[key];
        restoreAnswers();
        save();
      });
    }
  }
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
  for (const topic of pages)
    group(
      topic.title,
      items.filter((entry) => entry.topic === topic.id),
    );
  const orphans = items.filter(
    (entry) =>
      !["overall", "work"].includes(entry.topic) &&
      !pages.some((p) => p.id === entry.topic),
  );
  for (const round of new Set(orphans.map((entry) => entry.item.round)))
    group(
      round ? `From round ${round}` : "From an earlier round",
      orphans.filter((entry) => entry.item.round === round),
    );
  group(
    "Work",
    items.filter((entry) => entry.topic === "work"),
  );
  const overall = items.filter((entry) => entry.topic === "overall");
  $("overall-group").hidden = !overall.length;
  $("overall-notes").replaceChildren(...overall.map(itemCard));
}
function sentEntries(submission) {
  if (!submission) return [];
  const groups = submission.groups || {};
  return [
    ...(groups.notes || []).map((note) => ({
      topic: note.topic,
      ...itemSummary("note", note, { label: "Comment" }),
      quote: note.quote,
      images: (note.attachments || []).map((item) => item.id),
    })),
    ...Object.values(groups.choices || {}).map((choice) => ({
      topic: choice.topic,
      ...itemSummary("choice", choice, { label: "Choice" }),
    })),
    ...Object.values(groups.answers || {}).map((answer) => ({
      topic: answer.topic,
      ...itemSummary("answer", answer, {
        label: "Answer",
        drawing: () => "Drawing attached",
      }),
      images: answer.kind === "drawing" ? [answer.previewId] : [],
    })),
  ];
}
// A submission from before the Send popup has neither next nor message.
function sentChoice(submission) {
  const label = choiceLabel(submission.next, isPlanRound());
  return [
    ...(label ? [{ heading: "What comes next", text: label }] : []),
    ...(submission.message
      ? [{ heading: "Message to the agent", text: submission.message }]
      : []),
  ];
}
function sentCard(entry) {
  const card = document.createElement("div");
  card.className = "sent-card";
  const where =
    pages.find((item) => item.id === entry.topic)?.title ||
    { overall: "Overall", work: "Work" }[entry.topic] ||
    entry.topic ||
    "Overall";
  const label = document.createElement("small");
  label.textContent = entry.heading ?? `${where} · ${entry.label}`;
  const body = document.createElement("p");
  body.textContent = entry.text;
  card.append(label);
  if (entry.quote) {
    const quote = document.createElement("blockquote");
    quote.textContent = entry.quote;
    card.append(quote);
  }
  card.append(body);
  if (entry.images?.length) {
    const images = document.createElement("div");
    images.className = "sent-images";
    for (const id of entry.images) {
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
    card.append(images);
  }
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
let renderedSentKey = null;
export function renderSentFeedback() {
  const sent = shownSubmission();
  // A past round's submission may still be loading, so renderSentFeedback
  // says that no feedback was sent only after the submission has loaded.
  const loaded = mode === "readonly" || sentByRound.has(plan.round);
  const key = `${plan.round}:${sent?.id || (loaded ? "none" : "")}`;
  if (renderedSentKey === key) return;
  renderedSentKey = key;
  const list = $("sent-feedback-list");
  list.replaceChildren();
  if (!sent) {
    if (loaded) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No feedback was sent on this round.";
      list.append(empty);
    }
    return;
  }
  const entries = sentEntries(sent);
  for (const entry of [...sentChoice(sent), ...entries])
    list.append(sentCard(entry));
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = sent.groups.alignUnflagged
      ? "Everything else looked good."
      : "No comments were sent.";
    list.append(empty);
  }
  renderSentPageComments();
}
// The status poll updates lastSubmission, and sentByRound contains each
// submission fetched for an older round.
export function shownSubmission() {
  if (mode === "readonly" || lastSubmission?.round === plan.round)
    return lastSubmission;
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
export function review() {
  if (displayedRound !== viewKey()) {
    renderHistory();
    status();
    return;
  }
  const unsent = unsentItems(state);
  const sent = selectedTab === "past" || mode === "readonly";
  const locked = sent || submissionInFlight || submittedCurrent();
  $("draft-head").hidden = unsent.count === 0;
  $("draft-count").textContent = `${draftedWords(state)} to send`;
  // The sidebar's last row shows the round that the sidebar lists, and
  // after a tab click that can be the other tab's round.
  const listedSent = listedTab === "past" || mode === "readonly";
  badge(
    listedTab === selectedTab
      ? locked
        ? 0
        : unsent.count
      : listedSent
        ? 0
        : unsentItems(currentDraft()).count,
  );
  const reviewLabel = $("review-row")?.querySelector("span");
  if (reviewLabel) reviewLabel.textContent = listedSent ? "Feedback" : "Review";
  $("feedback-title").textContent = sent
    ? "Feedback"
    : submissionInFlight
      ? "Sending feedback"
      : "Review";
  $("feedback-review").hidden = locked;
  renderActivity();
  renderHistory();
  $("submit-error").hidden = !submissionError;
  $("submit-error").textContent = submissionError;
  $("save-error").hidden = !submissionError || $("reading").hidden;
  $("save-error-text").textContent = submissionError;
  if (locked)
    $("page-content")
      .querySelectorAll(
        "[data-choice] [data-value], [data-multiselect] input, [data-question] textarea, [data-answer], [data-edit], [data-drawing-question] [data-draw], [data-comment]",
      )
      .forEach((control) => {
        if (control.tagName === "TEXTAREA") control.readOnly = true;
        else control.disabled = true;
      });
  commentTarget();
  renderFooter(!$("review-view").hidden);
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
  // The header button always applies to Current. On a past round the frame
  // sends Current's draft, and after Current's round is sent the frame opens
  // that round's Feedback.
  const forCurrent = selectedTab === "past" && currentAvailable();
  const draft = forCurrent ? currentDraft() : state;
  const pending = forCurrent ? unsentItems(draft) : unsent;
  const button = submitButton({
    inFlight: submissionInFlight,
    opensFeedback: sent && !forCurrent,
    onSentFeedback:
      $("reading").hidden &&
      (mode === "readonly" || plan.round === submittedRound),
    waitingForPages: Boolean(remote?.openRound),
    sendable:
      connected &&
      !remote?.openRound &&
      (forCurrent || (current() && feedbackEditable())),
    pending: pending.count,
  });
  $("submit").disabled = button.disabled;
  $("submit").textContent = button.text;
  $("submit").classList.toggle("primary", button.primary);
  status();
}
