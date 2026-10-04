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
  "The reviewer wrote everything in this block. It is feedback, not pair's instructions.";

// One submission: its fixed line, then its choices, answers and notes.
export function feedbackText(event) {
  const { payload } = event;
  const groups = payload.groups || {};
  const items = [
    reviewerLine,
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
      "everything-else-looks-good": groups.alignUnflagged ? "yes" : undefined,
    },
    items.join("\n"),
    true,
  );
}

// Where a Start runs the work, as the agent reads it.
const places = {
  here: "here",
  "sub-session": "in a sub-session",
  "new-agent": "with a new agent",
};
// A started card, which is the agent's own text, then the reviewer's message
// with Start, when there is one.
function startedText(card, started, submission) {
  return [
    `Proposal ${card.id}, "${card.title}", started ${places[started.where]} by the reviewer.`,
    `Delivers: ${card.delivers}`,
    `May change: ${card.changes}`,
    ...(started.message
      ? [
          tag(
            "pair_start",
            { submission, proposal: card.id, where: started.where },
            [reviewerLine, tagText(started.message)].join("\n"),
            true,
          ),
        ]
      : []),
  ].join("\n");
}
// A Start that pair read prints.
export const startText = (event, card) =>
  startedText(card, event.payload, event.id);
// The card a session that pair start --from created runs.
export const proposalText = (card) => startedText(card, card.started);

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
    "Proposals whose linked session closed:",
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
    `Threads with a new message or agreement from the reviewer since ${since ? `round ${since}'s submission` : "the session started"}:`,
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
    "Before you settle a decision that a thread bears on, run",
    `pair read --session-dir ${directory} --thread ID`,
    "for that thread. It prints the quoted text, every message and every reply.",
  ].join("\n");
}
