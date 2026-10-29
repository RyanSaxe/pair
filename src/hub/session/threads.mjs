import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { problems } from "../../build/lint.mjs";
import { idPattern } from "../../shared/records.mjs";
import { atomic, read, requireValue, timestamp } from "../../shared/util.mjs";

export async function readThreads(directory) {
  const folder = path.join(directory, "threads");
  const names = (await fs.readdir(folder)).filter((name) =>
    name.endsWith(".json"),
  );
  const list = await Promise.all(
    names.map((name) => read(path.join(folder, name))),
  );
  return new Map(list.map((thread) => [thread.id, thread]));
}
const text = (value) => typeof value === "string" && value.trim().length > 0;
const optional = (value) => value === undefined || typeof value === "string";
// The reviewer answers a decision, a checklist or a question only with Send
// feedback, so checkReply refuses a reply that contains one.
const control =
  /<[a-zA-Z][^>]*\sdata-(?:choice|multiselect|question|drawing-question)=/;
// The hub quotes the reviewer's message in a thread's wake, as it does in a
// Start's wake, so the holder can read a short message before it runs pair
// read. A thread message has no length limit, so wakeNote quotes at most the
// first 500 characters, cut at a space, and pair read prints the whole
// message.
const quoted = 500;
function wakeNote(message) {
  const words = message.text;
  let note;
  if (words.length <= quoted)
    note = `The reviewer's message, which pair read also prints:\n${words}`;
  else {
    const space = words.slice(0, quoted + 1).search(/\s\S*$/);
    const opening = words.slice(0, space > 0 ? space : quoted).trimEnd();
    note = `The beginning of the reviewer's message, which pair read prints whole:\n${opening}…`;
  }
  const count = message.attachments?.length ?? 0;
  if (count === 1)
    note +=
      "\n\nThe reviewer attached an image to the message. pair read prints its path.";
  else if (count > 1)
    note += `\n\nThe reviewer attached ${count} images to the message. pair read prints their paths.`;
  return `\n\n${note}`;
}

// A thread is a note that the reviewer sends to the agent at once, with the
// replies under it. No thread action changes the round.
export function threads(session) {
  const { directory, threadRecords: records } = session;
  const readCommand = (id) =>
    `pair read --session-dir ${directory} --thread ${id}`;
  const replyCommand = (id) =>
    `pair reply --session-dir ${directory} --thread ${id}`;
  async function saveThread(thread) {
    thread.updatedAt = timestamp();
    await atomic(path.join(directory, "threads", `${thread.id}.json`), thread);
  }
  // shown leaves out the result of the thread's last wake, because its
  // reason can contain the holder's socket path.
  const shown = ({ wake, ...thread }) => thread;
  const threadView = () =>
    [...records.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(shown);
  // The frame sends the topic overall for Review's overall comment and work
  // for the Work page.
  const ownTitles = {
    agreed: "Agreed so far",
    overall: "Overall feedback",
    work: "Work",
  };
  function pageTitle(round, topic) {
    if (Object.hasOwn(ownTitles, topic)) return ownTitles[topic];
    return session.state.roundPages?.[round]?.pages.find(
      (slot) => slot.id === topic,
    )?.title;
  }
  async function reviewerMessage(data) {
    requireValue(text(data.text), "A thread message needs text");
    const attachments = data.attachments ?? [];
    requireValue(
      Array.isArray(attachments),
      "A message's attachments must be an array",
    );
    const images = [];
    for (const item of attachments) {
      requireValue(
        item && typeof item.id === "string",
        "An attachment needs its image ID",
      );
      images.push(await session.storedAttachment(item));
    }
    return {
      from: "reviewer",
      at: timestamp(),
      text: data.text.trim(),
      ...(images.length ? { attachments: images } : {}),
    };
  }
  // The hub wakes the holder for a thread's first message and for each
  // message after the agent read or answered the thread. wakeLater sends the
  // wake after the hub answers the browser's request.
  function wakeLater(thread) {
    const message = thread.messages.at(-1);
    setTimeout(
      () => session.exclusive(() => wakeHolder(thread.id, message)),
      0,
    );
  }
  async function wakeHolder(id, message) {
    const thread = records.get(id);
    const on = thread.proposal
      ? `proposal ${thread.proposal}, "${thread.page}"`
      : `"${thread.page}"`;
    const line = `pair: the reviewer wrote to you in a thread on ${on} in session ${directory}. Between your current steps, run ${readCommand(thread.id)}, which prints the thread and how to answer it, then go on with your work.${wakeNote(message)}`;
    const wake = await session.sendWake(line);
    // The agent may have opened the thread while the wake ran.
    const state =
      thread.state === "sending" ? (wake.ok ? "sent" : "failed") : thread.state;
    // threadView reads the thread from memory, so wakeHolder updates it in
    // memory only after saveThread writes the wake's result to the file.
    const settled = { ...thread, wake, state };
    await saveThread(settled);
    Object.assign(thread, settled);
  }
  function open() {
    requireValue(
      session.state.stage !== "complete",
      "This session is closed",
      409,
    );
  }
  async function cardThread(data) {
    const card = session
      .proposalItems()
      .find((item) => item.id === data.proposal);
    requireValue(card, `No proposal ${data.proposal} in this session`, 404);
    const message = await reviewerMessage(data);
    return {
      id: data.id,
      proposal: card.id,
      page: card.title,
      state: "sending",
      readAt: null,
      createdAt: message.at,
      messages: [message],
    };
  }
  async function startThread(data) {
    open();
    requireValue(idPattern.test(data.id || ""), "A thread needs an ID");
    requireValue(!records.has(data.id), "This thread already exists", 409);
    if (data.proposal !== undefined) {
      const thread = await cardThread(data);
      records.set(thread.id, thread);
      await saveThread(thread);
      wakeLater(thread);
      return { thread: shown(thread) };
    }
    const current = session.state.current;
    requireValue(
      current && data.round === current.round,
      "Start a thread on the current round",
      409,
    );
    const page = pageTitle(data.round, data.topic);
    requireValue(page, "A thread starts on one of the round's pages");
    requireValue(text(data.anchor), "A thread needs the block it is on");
    requireValue(
      [data.quote, data.target, data.agreementId].every(optional),
      "A thread's quote, target and agreement are text",
    );
    // occurrence is the appearance of the quote in its block that the
    // reviewer selected, counting from 1.
    requireValue(
      data.occurrence === undefined ||
        (Number.isInteger(data.occurrence) && data.occurrence > 0),
      "A thread's occurrence is a whole number from 1",
    );
    if (data.diffLine !== undefined)
      requireValue(
        data.diffLine &&
          typeof data.diffLine === "object" &&
          !Array.isArray(data.diffLine) &&
          ["additions", "deletions"].includes(data.diffLine.side) &&
          Number.isInteger(data.diffLine.lineNumber) &&
          data.diffLine.lineNumber > 0 &&
          text(data.quote) &&
          text(data.target),
        "A diff line needs a side, a positive line number, a quote and a target",
      );
    // diagramNode is the ID that Pele assigns to the diagram box the thread
    // is on.
    if (data.diagramNode !== undefined)
      requireValue(
        text(data.diagramNode) && text(data.quote) && text(data.target),
        "A diagram box needs its ID, a quote and a target",
      );
    const message = await reviewerMessage(data);
    const thread = {
      id: data.id,
      name: current.name,
      round: data.round,
      topic: data.topic,
      page,
      anchor: data.anchor.trim(),
      ...(text(data.quote) ? { quote: data.quote.trim() } : {}),
      ...(text(data.target) ? { target: data.target } : {}),
      ...(data.occurrence > 1 ? { occurrence: data.occurrence } : {}),
      ...(data.diffLine
        ? {
            diffLine: {
              side: data.diffLine.side,
              lineNumber: data.diffLine.lineNumber,
            },
          }
        : {}),
      ...(data.diagramNode ? { diagramNode: data.diagramNode } : {}),
      ...(text(data.agreementId) ? { agreementId: data.agreementId } : {}),
      state: "sending",
      readAt: null,
      createdAt: message.at,
      messages: [message],
    };
    records.set(thread.id, thread);
    await saveThread(thread);
    wakeLater(thread);
    return { thread: shown(thread) };
  }
  async function agentThread(card, text) {
    open();
    const at = timestamp();
    const thread = {
      id: crypto.randomUUID(),
      kind: "open-agent",
      proposal: card.id,
      page: card.title,
      state: "sending",
      readAt: null,
      createdAt: at,
      messages: [{ from: "reviewer", at, text }],
    };
    records.set(thread.id, thread);
    await saveThread(thread);
    wakeLater(thread);
    return shown(thread);
  }
  // Until a session links to the card, pair read --thread on an open-agent
  // thread prints the step to open an agent that runs pair start --from.
  const opensAgent = (thread) =>
    thread.kind === "open-agent" &&
    !session.proposalItems().find((card) => card.id === thread.proposal)
      ?.started?.session;
  function threadFor(id) {
    const thread = records.get(id);
    requireValue(thread, `No thread ${id} in this session`, 404);
    return thread;
  }
  async function addThreadMessage(id, data) {
    open();
    const thread = threadFor(id);
    const replyId = data.replyId;
    if (replyId !== undefined) {
      requireValue(
        typeof replyId === "string" && idPattern.test(replyId),
        "A thread reply needs a valid reply ID",
      );
      if (thread.messages.some((message) => message.replyId === replyId))
        return { thread: shown(thread) };
    }
    thread.messages.push({
      ...(replyId === undefined ? {} : { replyId }),
      ...(await reviewerMessage(data)),
    });
    // pair read --thread prints every message, so a message added before
    // the agent reads the thread needs no wake of its own, and the thread
    // keeps its state.
    const unread = ["sending", "sent"].includes(thread.state);
    if (!unread) {
      thread.state = "sending";
      thread.readAt = null;
    }
    await saveThread(thread);
    if (!unread) wakeLater(thread);
    return { thread: shown(thread) };
  }
  // The hub sends no wake for a thumbs up or for its removal.
  async function acknowledge(id, data) {
    open();
    const thread = threadFor(id);
    const message = Number.isInteger(data.message)
      ? thread.messages[data.message]
      : null;
    requireValue(
      message?.from === "agent",
      "Only an agent's message takes a thumbs up",
    );
    requireValue(
      typeof data.acknowledged === "boolean",
      "acknowledged is true or false",
    );
    if (!data.acknowledged) delete message.acknowledgedAt;
    else message.acknowledgedAt ??= timestamp();
    await saveThread(thread);
    return { thread: shown(thread) };
  }
  // The frame's bell leaves out a reply that the reviewer gave a thumbs up.
  const withAcknowledgements = (events) =>
    events.map((event) =>
      event.thread &&
      records.get(event.thread)?.messages[event.message]?.acknowledgedAt
        ? { ...event, acknowledged: true }
        : event,
    );
  // A reply can show only the prototypes that its round's pages contain.
  async function roundPrototypes(round) {
    const found = [];
    for (const slot of session
      .pageSet(round)
      .pages.filter((item) => item.version)) {
      const record = await session.pageRecord(round, slot.id, slot.version);
      found.push(...(record.page.prototypes || []));
    }
    return found;
  }
  async function checkReply(thread, html) {
    requireValue(
      !control.test(html),
      "A reply cannot contain a decision, a checklist or a question, because the reviewer answers those only in a round's feedback. Say in the reply what you will ask, and put the question on a page in the next round.",
    );
    const found = problems(
      {
        pages: [{ id: "reply", title: "Reply", html }],
        prototypes: thread.round ? await roundPrototypes(thread.round) : [],
      },
      "",
      { allowUnknownPages: true },
    );
    requireValue(!found.length, found.join("\n"));
  }
  // pair read --thread calls reply with no text or HTML, and reply then
  // marks the thread read and returns it. With text or HTML, reply posts the
  // agent's reply.
  async function reply(data) {
    requireValue(
      idPattern.test(data.note || ""),
      "Give --thread the ID of a thread that pair read printed.",
    );
    const thread = threadFor(data.note);
    requireValue(
      data.text === undefined || data.html === undefined,
      "pair reply takes --text or --file, not both",
    );
    if (data.text === undefined && data.html === undefined) {
      // Reading a thread again leaves a thread the agent answered as replied.
      if (
        thread.messages.at(-1).from === "reviewer" &&
        thread.state !== "read"
      ) {
        thread.state = "read";
        thread.readAt = timestamp();
        await saveThread(thread);
      }
      await session.transition(session.report());
      if (opensAgent(thread))
        return {
          status: session.view(),
          thread: shown(thread),
          next: `Open a new agent session and have it run pair start --from ${directory} --proposal ${thread.proposal} first, then post what you opened with ${replyCommand(thread.id)} --text "…". If you cannot open one, post that command instead. Then go back to what you were doing.`,
          moment: "read-open-agent",
        };
      return {
        status: session.view(),
        thread: shown(thread),
        next: thread.messages.at(-1).acknowledgedAt
          ? "The reviewer agreed with your last message, so do not reply. Go back to what you were doing."
          : `Post your answer with ${replyCommand(thread.id)} --text "…", or with --file reply.html in place of --text, then go back to what you were doing.`,
        moment: "read-thread",
      };
    }
    if (data.html !== undefined) {
      requireValue(text(data.html), "The reply file is empty");
      await checkReply(thread, data.html);
    } else requireValue(text(data.text), "--text needs the reply's text");
    thread.messages.push({
      from: "agent",
      at: timestamp(),
      ...(data.html !== undefined
        ? { html: data.html.trim() }
        : { text: data.text.trim() }),
    });
    thread.state = "replied";
    await saveThread(thread);
    await session.addActivity({
      kind: "reply",
      name: thread.page,
      ...(thread.proposal
        ? { page: "work", proposal: thread.proposal }
        : { round: thread.round, page: thread.topic }),
      ...(thread.target ? { target: thread.target } : {}),
      thread: thread.id,
      message: thread.messages.length - 1,
    });
    await session.transition(session.report());
    return {
      status: session.view(),
      next: `Go back to what you were doing. ${await session.nextStep()}`,
    };
  }
  // threadsSince lists threads for pair read's index. acknowledged contains
  // the positions, counting from 1, of the messages with a thumbs up.
  function threadsSince(at) {
    return [...records.values()]
      .map((thread) => {
        const latest = thread.messages.findLast(
          (item) => item.from === "reviewer",
        );
        const acknowledged = thread.messages.flatMap((item, index) =>
          item.acknowledgedAt ? [index + 1] : [],
        );
        const last = [
          latest?.at,
          ...thread.messages.map((item) => item.acknowledgedAt),
        ]
          .filter(Boolean)
          .sort()
          .at(-1);
        return { thread, latest, acknowledged, last };
      })
      .filter(({ latest, last }) => latest && (!at || last > at))
      .sort((a, b) => a.last.localeCompare(b.last))
      .map(({ thread, latest, acknowledged }) => ({
        id: thread.id,
        topic: thread.topic,
        proposal: thread.proposal,
        messages: thread.messages.length,
        latest: latest.text,
        ...(acknowledged.length ? { acknowledged } : {}),
      }));
  }
  // The agent can cite a thread that settled a decision in Agreed's source,
  // as it cites a note.
  function threadSource(id) {
    const thread = records.get(id);
    requireValue(
      thread,
      `Agreed cites thread ${id}, which this session does not have. Cite a thread ID that pair read printed.`,
    );
    return thread;
  }
  return {
    threadView,
    startThread,
    agentThread,
    addThreadMessage,
    acknowledge,
    withAcknowledgements,
    reply,
    threadsSince,
    threadSource,
  };
}
