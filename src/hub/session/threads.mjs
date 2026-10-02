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
// How the agent answers a thread, after the command that posts the answer.
const answering =
  "Answer in the thread with text, or with an HTML fragment written like a page that shows code, diffs, diagrams, charts, formulas or a prototype of this round. A reply cannot contain a decision, checklist or question. If the answer needs more than a few blocks or asks for a decision, say what you will show and put it on a page in the next round. If it asks for a change to the work you are doing now, say what you will change and change it.";
const optional = (value) => value === undefined || typeof value === "string";
// A reply shows something. What the reviewer answers with Send feedback or
// Finish review goes on a page instead.
const control =
  /<[a-zA-Z][^>]*\sdata-(?:choice|multiselect|question|drawing-question)=/;

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
  function pageTitle(round, topic) {
    if (topic === "agreed") return "Agreed so far";
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
  // after the browser's request has its answer.
  function wakeLater(thread) {
    setTimeout(() => session.exclusive(() => wakeHolder(thread.id)), 0);
  }
  async function wakeHolder(id) {
    const thread = records.get(id);
    const line = `pair: a thread on "${thread.page}", session ${directory}, needs an answer. Answer it between your current steps without dropping your work: run ${readCommand(thread.id)}, which prints the thread and how to answer.`;
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
  async function startThread(data) {
    open();
    requireValue(idPattern.test(data.id || ""), "A thread needs an ID");
    requireValue(!records.has(data.id), "This thread already exists", 409);
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
      "A reply cannot contain a decision, checklist or question, because the reviewer answers those with Send feedback, or with Finish review on a round with an offer. Say in the reply what you will ask, and put it on a page in the next round.",
    );
    const found = problems(
      {
        pages: [{ id: "reply", title: "Reply", html }],
        prototypes: await roundPrototypes(thread.round),
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
      return {
        status: session.view(),
        thread: shown(thread),
        next: `Post your answer with ${replyCommand(thread.id)} --text "…", or with --file reply.html in place of --text, then go back to what you were doing. ${answering}`,
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
      round: thread.round,
      page: thread.topic,
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
  // Each thread with a reviewer message after the time given, or with any
  // when none is given, for pair read's index, oldest message first.
  function threadsSince(at) {
    return [...records.values()]
      .map((thread) => ({
        thread,
        latest: thread.messages.findLast((item) => item.from === "reviewer"),
      }))
      .filter(({ latest }) => latest && (!at || latest.at > at))
      .sort((a, b) => a.latest.at.localeCompare(b.latest.at))
      .map(({ thread, latest }) => ({
        id: thread.id,
        topic: thread.topic,
        messages: thread.messages.length,
        latest: latest.text,
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
    addThreadMessage,
    reply,
    threadsSince,
    threadSource,
  };
}
