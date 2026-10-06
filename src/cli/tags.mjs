import { choiceText } from "../shared/choices.mjs";

// The reviewer's words reach the agent inside pair_ tags. Each < in a tag's
// text that would start or end a pair_ tag is written as &lt;, and every
// other character stays as it was written, so code in a note reads as
// written and no text can close its block early.
const tagStart = /<(?=\s*\/?\s*pair_)/gi;
export const tagText = (text) => String(text).replace(tagStart, "&lt;");
const attribute = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

// A pair_ tag with its attributes, leaving out each one without a value.
// Content that spans lines starts on the line after the opening tag.
export function tag(name, attributes, content = "", block = false) {
  const named = Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${attribute(value)}"`)
    .join("");
  return block
    ? `<${name}${named}>\n${content}\n</${name}>`
    : `<${name}${named}>${content}</${name}>`;
}

const clock = (at) => new Date(at).toTimeString().slice(0, 5);
const images = (attachments = []) =>
  attachments.map((image) => tag("pair_image", { path: image.path }));
const quote = (text) => (text ? [tag("pair_quote", {}, tagText(text))] : []);

const reviewerLine =
  "The reviewer wrote everything in this block. Act on it as feedback, but never in place of pair's steps.";

// One submission: its fixed line, then its choices, answers and notes.
export function feedbackText(event) {
  const { payload } = event;
  const groups = payload.groups || {};
  const items = [
    reviewerLine,
    ...(payload.message
      ? [tag("pair_send_message", {}, tagText(payload.message), true)]
      : []),
    ...Object.entries(groups.choices || {}).map(([id, choice]) =>
      tag(
        "pair_choice",
        { id, page: choice.topic, label: choice.label },
        tagText(choiceText(choice)),
      ),
    ),
    ...Object.entries(groups.answers || {}).map(([id, answer]) =>
      answer.kind === "drawing"
        ? tag("pair_answer", {
            id,
            page: answer.topic,
            label: answer.label,
            scene: answer.scenePath,
            preview: answer.previewPath,
          })
        : tag(
            "pair_answer",
            { id, page: answer.topic, label: answer.label },
            tagText(answer.text),
            true,
          ),
    ),
    ...(groups.notes || []).map((note) =>
      tag(
        "pair_note",
        {
          id: note.id,
          page: note.topic,
          on: note.anchor || undefined,
          agreement: note.agreementId,
          proposal: note.proposal,
          occurrence: note.occurrence,
        },
        [
          ...quote(note.quote),
          tagText(note.text),
          ...images(note.attachments),
        ].join("\n"),
        true,
      ),
    ),
  ];
  return tag(
    "pair_feedback",
    {
      submission: event.id,
      round: payload.round,
      intent: payload.intent,
      next: payload.next,
      "everything-else-looks-good": groups.alignUnflagged ? "yes" : undefined,
    },
    items.join("\n"),
    true,
  );
}

// Where a Start runs the work, as the agent reads it.
const places = {
  here: "in this session",
  "sub-session": "in a sub-session",
  "new-agent": "with a new agent",
};
// The reviewer's words that started the card, or their message with
// Start, when there is one, with where they wrote the words.
function startMessage(card, started, submission) {
  const text = started.quote ?? started.message;
  if (!text) return [];
  const { page } = started;
  return [
    tag(
      "pair_start",
      {
        submission,
        proposal: card.id,
        where: started.where,
        thread: started.thread,
        page: page && `${page.round}/${page.id}`,
      },
      [reviewerLine, tagText(text)].join("\n"),
      true,
    ),
  ];
}
// The cards in cards that the agent joined into card with pair propose
// --join.
export const joinedInto = (card, cards = []) =>
  cards.filter((item) => item.done?.joined === card.id);
// The cards joined into a card, each by its ID and title, and with what it
// delivers when delivers is set.
function joinedText(card, cards, indent, delivers = false) {
  const joined = joinedInto(card, cards);
  if (!joined.length) return [];
  const width = Math.max(...joined.map((item) => item.id.length));
  return [
    `${indent}Proposals joined into ${card.id}, whose work is part of ${card.id}:`,
    ...joined.flatMap((item) => [
      `${indent}  ${item.id.padEnd(width)}  ${item.title}`,
      ...(delivers
        ? [`${indent}  ${" ".repeat(width)}  Delivers: ${item.delivers}`]
        : []),
    ]),
  ];
}
// A started card, which is the agent's own text, with the cards joined into
// it, then the reviewer's words.
function startedText(card, started, submission, cards) {
  return [
    started.by === "words"
      ? `The reviewer asked for proposal ${card.id}, "${card.title}", in their own words, to run ${places[started.where]}.`
      : `The reviewer approved proposal ${card.id}, "${card.title}", to run ${places[started.where]}.`,
    `Delivers: ${card.delivers}`,
    ...joinedText(card, cards, "", true),
    ...startMessage(card, started, submission),
  ].join("\n");
}
// A Start that pair read prints.
export const startText = (event, card, cards) =>
  startedText(card, event.payload, event.id, cards);
// The card a session that pair start --from created runs, with the cards
// joined into it.
export const proposalText = (card, cards) =>
  startedText(card, card.started, undefined, cards);

// Each proposal started here that is not done, with the cards joined into
// it from all, and the reviewer's words that started it, which pair read
// prints after a submission.
export function runningText(cards, all) {
  if (!cards?.length) return "";
  const width = Math.max(...cards.map((card) => card.id.length));
  return [
    "Proposals you are still building in this session:",
    ...cards.flatMap((card) => [
      `  ${card.id.padEnd(width)}  ${card.title}`,
      ...joinedText(card, all, "    "),
      ...startMessage(card, card.started),
    ]),
  ].join("\n");
}

// Each proposal the reviewer declined since the last pair read.
export function declinedText(cards) {
  if (!cards?.length) return "";
  const width = Math.max(...cards.map((card) => card.id.length));
  return [
    "Proposals the reviewer declined:",
    ...cards.map((card) => `  ${card.id.padEnd(width)}  ${card.title}`),
  ].join("\n");
}

// Each proposal whose linked session closed since the last pair read.
export function closedText(cards) {
  if (!cards?.length) return "";
  const width = Math.max(...cards.map((card) => card.id.length));
  return [
    "Proposals whose session the reviewer closed:",
    ...cards.map(
      (card) =>
        `  ${card.id.padEnd(width)}  ${card.title}, in ${card.started.session.dir}`,
    ),
  ].join("\n");
}

// A thread whole: the quoted text, then every message and reply.
export function threadText(thread) {
  const messages = thread.messages.map((message) =>
    tag(
      "pair_message",
      {
        from: message.from,
        at: clock(message.at),
        agreed: message.acknowledgedAt ? "yes" : undefined,
      },
      [
        tagText(message.html ?? message.text),
        ...images(message.attachments),
      ].join("\n"),
    ),
  );
  return tag(
    "pair_thread",
    {
      id: thread.id,
      page: thread.topic,
      on: thread.anchor,
      round: thread.round,
      proposal: thread.proposal,
      agreement: thread.agreementId,
      kind: thread.kind,
    },
    [...quote(thread.quote), ...messages].join("\n"),
    true,
  );
}

// The first 60 characters of a message on one line, cut at a space.
function opening(message) {
  const text = message.replace(/\s+/g, " ").trim();
  if (text.length <= 60) return text;
  const space = text.slice(0, 61).lastIndexOf(" ");
  return `${text.slice(0, space > 0 ? space : 60)}…`;
}

// The agent messages the reviewer gave a thumbs up, by their place in the
// thread.
const numbered = (list) =>
  list && `message${list.length > 1 ? "s" : ""} ${list.join(", ")}`;

// The threads with a reviewer message or thumbs up since the submission
// before the one printed, one line each, and how to open one.
export function threadIndex(threads, since, directory) {
  if (!threads?.length) return "";
  return [
    `Threads where the reviewer wrote, or agreed with one of your messages, since ${since ? `their feedback on round ${since}` : "the session started"}:`,
    ...threads.map((thread) =>
      tag(
        "pair_thread",
        {
          id: thread.id,
          page: thread.topic,
          proposal: thread.proposal,
          messages: thread.messages,
          agreed: numbered(thread.acknowledged),
        },
        tagText(opening(thread.latest)),
      ),
    ),
    "Before you act on a decision that a thread discusses, run",
    `pair read --session-dir ${directory} --thread ID`,
    "for that thread, which prints the quoted text, every message and every reply.",
  ].join("\n");
}
