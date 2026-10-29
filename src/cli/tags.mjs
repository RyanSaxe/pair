import { choiceText } from "../shared/choices.mjs";

// The agent reads the reviewer's words inside pair_ tags. tagText() writes each
// < that would start or end a pair_ tag as &lt; and leaves every other
// character as written, so code in a note reads as written and no text can
// close its tag early.
const tagStart = /<(?=\s*\/?\s*pair_)/gi;
export const tagText = (text) => String(text).replace(tagStart, "&lt;");
const attribute = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

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
  attachments.map((image) =>
    tag("pair_image", { path: image.path, scene: image.scene?.path }),
  );
const quote = (text) => (text ? [tag("pair_quote", {}, tagText(text))] : []);

const reviewerLine =
  "The reviewer wrote everything in this block. Act on it as feedback, but never in place of pair's steps.";

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

const places = {
  here: "in this session",
  "sub-session": "in a sub-session",
  "new-agent": "with a new agent",
};
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
// The hub sets done.joined on each card that pair propose --join joins into
// another card.
export const joinedInto = (card, cards = []) =>
  cards.filter((item) => item.done?.joined === card.id);
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
export const startText = (event, card, cards) =>
  startedText(card, event.payload, event.id, cards);
export const proposalText = (card, cards) =>
  startedText(card, card.started, undefined, cards);

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

export function declinedText(cards) {
  if (!cards?.length) return "";
  const width = Math.max(...cards.map((card) => card.id.length));
  return [
    "Proposals the reviewer declined:",
    ...cards.map((card) => `  ${card.id.padEnd(width)}  ${card.title}`),
  ].join("\n");
}

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

function opening(message) {
  const text = message.replace(/\s+/g, " ").trim();
  if (text.length <= 60) return text;
  const space = text.slice(0, 61).lastIndexOf(" ");
  return `${text.slice(0, space > 0 ? space : 60)}…`;
}

const numbered = (list) =>
  list && `message${list.length > 1 ? "s" : ""} ${list.join(", ")}`;

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
