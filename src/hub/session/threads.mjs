import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { problems } from "../../build/lint.mjs";
import { idPattern } from "../../shared/records.mjs";
import { atomic, read, requireValue, timestamp } from "../../shared/util.mjs";

// Every thread in a session, read from disk once. saveThread writes each
// change back.
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
// A reply shows something. What the reviewer answers with Send feedback goes
// on a page instead.
const control =
  /<[a-zA-Z][^>]*\sdata-(?:choice|multiselect|question|drawing-question)=/;
// The hub quotes the reviewer's message in a thread's wake, as it does in a
// Start's wake, so the holder can read a short message before it runs pair
// read. A thread message has no length limit, so the hub quotes at most the
// first 500 characters of a longer message, cut at a space, and pair read
// prints the message whole.
const quoted = 500;
function wakeNote(message) {
  const words = message.text;
  let note;
  if (words.length <= quoted)
    note = `The reviewer's message, which pair read prints too:\n${words}`;
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

// Threads: a note the reviewer sends to the agent at once, and the replies
// under it. A thread never changes the round.
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
  // The browser sees each thread without the result of its last wake,
  // whose reason can name the holder's socket.
  const shown = ({ wake, ...thread }) => thread;
  const threadView = () =>
    [...records.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(shown);
  // A thread starts on a page of the round, or on Review's overall comment
  // or on Work, which the frame names overall and work.
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
  // Each message the reviewer sends: its text and the images it names,
  // each of which the session must have.
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
      const name = await session.uploadName(item.id);
      requireValue(name, `Image ${item.id} is not in this session`);
      const image = await session.readUpload(item.id);
      images.push({
        id: item.id,
        path: path.join(directory, "uploads", name),
        type: image.type,
        bytes: image.bytes.length,
      });
    }
    return {
      from: "reviewer",
      at: timestamp(),
      text: data.text.trim(),
      ...(images.length ? { attachments: images } : {}),
    };
  }
  // The hub wakes the holder once for each message the reviewer sends,
  // after the browser's request has its answer, with that message.
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
    const line = `pair: a thread on ${on}, session ${directory}, needs an answer. Answer it between your current steps without dropping your work: run ${readCommand(thread.id)}, which prints the thread and how to answer.${wakeNote(message)}`;
    thread.wake = await session.sendWake(line);
    // The agent may have opened the thread while the wake ran.
    if (thread.state === "sending")
      thread.state = thread.wake.ok ? "sent" : "failed";
    await saveThread(thread);
  }
  function open() {
    requireValue(
      session.state.stage !== "complete",
      "This session is closed",
      409,
    );
  }
  // A thread on a proposal's card names the card instead of a round, a page
  // and a block, and its page is the card's title.
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
    // Which appearance of the quote in its block the reviewer selected,
    // counting from 1.
    requireValue(
      data.occurrence === undefined ||
        (Number.isInteger(data.occurrence) && data.occurrence > 0),
      "A thread's occurrence is a whole number from 1",
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
  // Open a new agent session on a card starts a thread of kind open-agent
  // with the reviewer's message, and wakes the holder as any thread does.
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
  // Until a session links to the card, the thread asks the holder to open
  // the agent that runs pair start --from.
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
    thread.messages.push(await reviewerMessage(data));
    thread.state = "sending";
    thread.readAt = null;
    await saveThread(thread);
    wakeLater(thread);
    return { thread: shown(thread) };
  }
  // The reviewer's thumbs up on one of the agent's messages, or its removal.
  // The hub sends no wake for it.
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
  // The bell drops the line of a reply the reviewer acknowledged.
  const withAcknowledgements = (events) =>
    events.map((event) =>
      event.thread &&
      records.get(event.thread)?.messages[event.message]?.acknowledgedAt
        ? { ...event, acknowledged: true }
        : event,
    );
  // The prototypes a reply may show are the ones its round already has.
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
      "A reply cannot contain a decision, checklist or question, because the reviewer answers those with Send feedback. Say in the reply what you will ask, and put it on a page in the next round.",
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
  // With no text the reply action marks the thread read and returns it, for
  // pair read --thread, and with text or HTML it posts the agent's reply.
  async function reply(data) {
    requireValue(
      idPattern.test(data.note || ""),
      "A reply names its thread with --thread ID",
    );
    const thread = threadFor(data.note);
    requireValue(
      data.text === undefined || data.html === undefined,
      "pair reply takes --text or --file, not both",
    );
    if (data.text === undefined && data.html === undefined) {
      // A thread the agent has answered stays answered when it is read again.
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
          next: `Open a new agent session whose first command is: pair start --from ${directory} --proposal ${thread.proposal}. Then post what you opened with ${replyCommand(thread.id)} --text "…", or post that command when you cannot open one, and go back to what you were doing.`,
          moment: "read-open-agent",
        };
      return {
        status: session.view(),
        thread: shown(thread),
        next: thread.messages.at(-1).acknowledgedAt
          ? "The reviewer agreed with your last message, so the thread needs no answer. Go back to what you were doing."
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
      // A reply on a card opens the Work page, under the card.
      ...(thread.proposal
        ? { page: "work", proposal: thread.proposal }
        : { round: thread.round, page: thread.topic }),
      ...(thread.target ? { target: thread.target } : {}),
      thread: thread.id,
      // The reply's place in the thread, so a notification opens the reply.
      message: thread.messages.length - 1,
    });
    await session.transition(session.report());
    return {
      status: session.view(),
      next: `Go back to what you were doing. ${await session.nextStep()}`,
    };
  }
  // Each thread with a reviewer message or thumbs up after the time given,
  // or every thread when none is given, for pair read's index, oldest first.
  // acknowledged numbers the agent messages with a thumbs up from 1.
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
  // Agreed cites a thread that settled a decision, as it cites a note.
  function threadSource(id) {
    const thread = records.get(id);
    requireValue(thread, "Source thread not found");
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
