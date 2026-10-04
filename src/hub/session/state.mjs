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
import { agent, answersRound } from "./agent.mjs";
import { links } from "./links.mjs";
import { pageNotes } from "./page-notes.mjs";
import { plans } from "./plans.mjs";
import { proposals } from "./proposals.mjs";
import { rounds } from "./rounds.mjs";
import { submissions } from "./submissions.mjs";
import { readThreads, threads } from "./threads.mjs";
import { uploads } from "./uploads.mjs";

// tabOpen says whether a pair tab on this machine polled the hub recently,
// and peer finds another session on the hub by its ID, for the session a
// linked session came from.
export async function loadSession(
  directory,
  config,
  origin,
  tabOpen,
  peer = () => null,
) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stateFile = path.join(directory, "status.json");
  let state = (await exists(stateFile))
    ? await read(stateFile)
    : {
        sessionId: crypto.randomUUID(),
        stage: "ready",
        current: null,
        acknowledged: [],
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
  // A closed session stays closed with feedback unread. A Start in a
  // sub-session leaves this session's round as it is.
  if ((await pending()).some(answersRound) && state.stage !== "complete")
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
  // A session's name: its round's title, or before its first round the
  // title in its status.
  const title = () =>
    state.current ? state.current.title : state.title || "New session";
  const active = () => state.stage !== "complete" && !state.paused;
  // The parts of a session share this context. A part calls another part's
  // function through it, so no part depends on the order they are made in.
  const session = {
    directory,
    config,
    origin,
    tabOpen,
    peer,
    base,
    exclusive,
    transition,
    events,
    saveEvent,
    pending,
    sameRound,
    needsYou,
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
    threads(session),
    await activity(session),
    await proposals(session),
    plans(session),
    links(session),
  );
  function view() {
    const { roundPages, holder, formerHolders, ...visible } = state;
    return {
      ...visible,
      // The holder's identity is a socket path or a thread ID, which stays
      // out of the browser like the rest of the wake target. The frame
      // cannot import the adapters, so the holder carries its CLI's name. Its
      // steerable, from its last wake, is true when its agent CLI reads a
      // message in the middle of a turn.
      holder: holder
        ? {
            harness: holder.harness,
            name: adapters[holder.harness].name,
            at: holder.at,
            steerable: holder.steerable,
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
      proposals: session.proposalItems(),
    };
  }
  // The browser draws every thread's card from its status. An agent reads a
  // thread with pair read --thread, so its commands print the status without
  // them.
  function browserView() {
    return {
      ...view(),
      sessionDir: directory,
      threads: session.threadView(),
      parent: session.parentView(),
    };
  }
  async function latestFeedback(requestedRound) {
    requireValue(
      requestedRound === null || roundPattern.test(requestedRound),
      "Invalid round",
    );
    const event = requestedRound
      ? events
          .filter((item) => item.payload.round === requestedRound)
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
      title: title(),
      // A linked session names the session and the proposal it came from.
      parentId: state.parent?.sessionId ?? null,
      proposal: state.parent?.proposal ?? null,
      closed: state.stage === "complete",
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
    title,
    exclusive,
    submit: session.submit,
    upload: session.upload,
    readUpload: session.readUpload,
    uploadScene: session.uploadScene,
    readScene: session.readScene,
    removeUpload: session.removeUpload,
    close: session.close,
    startProposal: session.startProposal,
    openAgent: session.openAgent,
    declineProposal: session.declineProposal,
    restoreProposal: session.restoreProposal,
    planFile: session.planFile,
    parentView: session.parentView,
    linkParent: session.linkParent,
    linkable: session.linkable,
    linkSession: session.linkSession,
    closedSession: session.closedSession,
    plannable: session.plannable,
    attachPlan: session.attachPlan,
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
