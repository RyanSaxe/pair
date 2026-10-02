import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { idPattern, roundPattern } from "../../shared/records.mjs";
import {
  atomic,
  exists,
  read,
  requireValue,
  serializer,
  timestamp,
} from "../../shared/util.mjs";
import { adapters } from "../wake.mjs";
import { activity } from "./activity.mjs";
import { agent } from "./agent.mjs";
import { pageNotes } from "./page-notes.mjs";
import { rounds } from "./rounds.mjs";
import { sideWork } from "./side-work.mjs";
import { submissions } from "./submissions.mjs";
import { readThreads, threads } from "./threads.mjs";
import { uploads } from "./uploads.mjs";

// tabOpen says whether a pair tab on this machine polled the hub recently.
export async function loadSession(directory, config, origin, tabOpen) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stateFile = path.join(directory, "status.json");
  let state = (await exists(stateFile))
    ? await read(stateFile)
    : {
        sessionId: crypto.randomUUID(),
        stage: "ready",
        current: null,
        acknowledged: [],
        accepted: null,
        startedAt: timestamp(),
        // Round 1 starts with the pair start that creates the session.
        roundStartedAt: timestamp(),
        updatedAt: timestamp(),
      };
  requireValue(
    idPattern.test(state.sessionId) && Array.isArray(state.acknowledged),
    "Invalid session state",
  );
  // A session another program created names its round some other way, and
  // pair reads only its own format.
  requireValue(
    !state.current || typeof state.current.round === "string",
    `${directory} is not a pair session, so pair does not open it. Start a new session.`,
  );
  // The session list numbers sessions in the order they started. A session
  // from before startedAt existed takes its directory's creation time, which
  // no later write changes.
  state.startedAt ||= (await fs.stat(directory)).birthtime.toISOString();
  for (const child of ["rounds", "feedback", "uploads", "scenes", "threads"])
    await fs.mkdir(path.join(directory, child), {
      recursive: true,
      mode: 0o700,
    });
  const connectionFile = path.join(directory, "connection.json");
  let token = null;
  if (await exists(connectionFile)) {
    const connection = await read(connectionFile);
    if (
      connection.sessionId === state.sessionId &&
      /^[0-9a-f]{64}$/.test(connection.token || "")
    )
      token = connection.token;
  }
  token ||= crypto.randomBytes(32).toString("hex");
  const base = `/s/${state.sessionId}`;
  const exclusive = serializer();
  // The wake target holds a token or a socket path, so it lives in its own
  // agent-private file and never in a browser response.
  const wakeFile = path.join(directory, "wake.json");
  const transition = async (patch) => {
    const next = { ...state, ...patch, updatedAt: timestamp() };
    await atomic(stateFile, next);
    state = next;
    return state;
  };
  // Every submission, read from disk once. saveEvent adds each new one.
  const events = await Promise.all(
    (await fs.readdir(path.join(directory, "feedback")))
      .filter((name) => name.endsWith(".json"))
      .map((name) => read(path.join(directory, "feedback", name))),
  );
  let sequence = events.reduce(
    (last, event) => Math.max(last, event.sequence),
    0,
  );
  async function saveEvent(payload) {
    const event = {
      id: payload.id,
      sequence: ++sequence,
      receivedAt: timestamp(),
      payload,
    };
    await atomic(path.join(directory, "feedback", payload.id + ".json"), event);
    events.push(event);
    return event;
  }
  async function pending() {
    return events
      .filter((event) => !state.acknowledged.includes(event.id))
      .sort((a, b) => a.sequence - b.sequence);
  }
  // A saved round keeps its acceptance unread until an agent reads it, and
  // stays saved. A closed session stays closed with feedback unread.
  if ((await pending()).length && !["saved", "complete"].includes(state.stage))
    await transition({ stage: "submitted" });
  else await atomic(stateFile, state);
  const sameRound = (event) =>
    state.current &&
    event.name === state.current.name &&
    event.round === state.current.round;
  const needsYou = () =>
    Boolean(state.current) &&
    !state.openRound &&
    ["ready", "updated"].includes(state.stage);
  // A saved session waits for an agent, so it does not keep the hub running.
  const active = () =>
    !["complete", "saved"].includes(state.stage) && !state.paused;
  // The parts of a session share this context. A part calls another part's
  // function through it, so no part depends on the order they are made in.
  const session = {
    directory,
    config,
    origin,
    tabOpen,
    base,
    exclusive,
    transition,
    events,
    saveEvent,
    pending,
    sameRound,
    view,
    browserView,
    wakeFile,
    threadRecords: await readThreads(directory),
    wake: (await exists(wakeFile)) ? await read(wakeFile) : null,
    get state() {
      return state;
    },
  };
  Object.assign(
    session,
    uploads(session),
    submissions(session),
    agent(session),
    rounds(session),
    pageNotes(session),
    await sideWork(session),
    threads(session),
    await activity(session),
  );
  function view() {
    const { roundPages, holder, formerHolders, ...visible } = state;
    return {
      ...visible,
      // The holder's identity is a socket path or a thread ID, which stays
      // out of the browser like the rest of the wake target. The frame
      // cannot import the adapters, so the holder carries its CLI's name.
      holder: holder
        ? {
            harness: holder.harness,
            name: adapters[holder.harness].name,
            at: holder.at,
          }
        : null,
      handoff: session.handoff,
      ...(state.openRound
        ? {
            openRound: {
              round: state.openRound.round,
              ...(state.openRound.agreedAt
                ? { agreedAt: state.openRound.agreedAt }
                : {}),
              pages: state.openRound.pages.map(
                ({ id, title, state, startedAt, note }) => ({
                  id,
                  title,
                  state,
                  ...(startedAt ? { startedAt } : {}),
                  ...(note ? { note } : {}),
                }),
              ),
            },
          }
        : {}),
      rounds: state.rounds || [],
      wake: state.wake || null,
      paused: state.paused || null,
      needsYou: needsYou(),
      sideWork: session.sideWorkItems(),
    };
  }
  // The browser draws every thread's card from its status. An agent reads a
  // thread with pair reply, so its commands print the status without them.
  function browserView() {
    return {
      ...view(),
      sessionDir: directory,
      threads: session.threadView(),
    };
  }
  async function latestFeedback(requestedRound) {
    requireValue(
      requestedRound === null || roundPattern.test(requestedRound),
      "Invalid round",
    );
    const event = requestedRound
      ? events
          .filter(
            (item) =>
              item.payload.intent === "feedback-only" &&
              item.payload.round === requestedRound,
          )
          .sort((a, b) => b.sequence - a.sequence)[0]
      : state.latestSubmissionId && idPattern.test(state.latestSubmissionId)
        ? await read(
            path.join(
              directory,
              "feedback",
              `${state.latestSubmissionId}.json`,
            ),
          )
        : null;
    if (!event) return null;
    if (event.payload.intent !== "feedback-only") return null;
    const { groups, round } = event.payload;
    return {
      id: event.id,
      round,
      receivedAt: event.receivedAt,
      groups: {
        alignUnflagged: groups.alignUnflagged,
        notes: (groups.notes || []).map(
          ({ topic, anchor, quote, text, attachments }) => ({
            topic,
            anchor,
            quote,
            text,
            attachments: (attachments || []).map(({ id }) => ({ id })),
          }),
        ),
        choices: groups.choices || {},
        answers: groups.answers || {},
      },
    };
  }
  // A session is listed from the pair start that creates it. Before its
  // first round it takes the title in its status, or "New session".
  function listing() {
    const round = state.current?.round ?? null;
    const set = state.roundPages?.[round];
    return {
      id: state.sessionId,
      title: state.current ? state.current.title : state.title || "New session",
      offer: state.current?.offer,
      round,
      stage: state.stage,
      needsYou: needsYou(),
      ...(state.openRound
        ? {
            openRound: {
              ready:
                1 +
                (state.openRound.pages || []).filter((item) => item.recordPath)
                  .length,
            },
          }
        : {}),
      // The current round's readable pages, so each tab can count the ones
      // its browser has not opened.
      readyPages: {
        round,
        ids: set
          ? [
              "agreed",
              ...set.pages
                .filter((slot) => slot.recordPath)
                .map(({ id }) => id),
            ]
          : [],
      },
      wakeFailed: state.wake?.last?.ok === false,
      paused: Boolean(state.paused),
      startedAt: state.startedAt,
      publishedAt: state.current?.publishedAt,
      updatedAt: state.updatedAt,
      url: base + "/",
      handoff: session.handoff,
      events: session.activityItems(),
    };
  }
  return {
    directory,
    token,
    base,
    get id() {
      return state.sessionId;
    },
    get state() {
      return state;
    },
    exclusive,
    submit: session.submit,
    upload: session.upload,
    readUpload: session.readUpload,
    uploadScene: session.uploadScene,
    readScene: session.readScene,
    removeUpload: session.removeUpload,
    dismiss: session.dismiss,
    startSideWork: session.startSideWork,
    dropSideWork: session.dropSideWork,
    startThread: session.startThread,
    addThreadMessage: session.addThreadMessage,
    act: session.act,
    browserView,
    latestFeedback,
    listing,
    active,
    hold: session.hold,
    roundEntry: session.roundEntry,
    pageSet: session.pageSet,
    pageRecord: session.pageRecord,
    prototype: session.prototype,
  };
}
