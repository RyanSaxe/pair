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
import { draftStore } from "./draft.mjs";
import { links } from "./links.mjs";
import { pageNotes } from "./page-notes.mjs";
import { proposals } from "./proposals.mjs";
import { quiet } from "./quiet.mjs";
import { rounds } from "./rounds.mjs";
import { nextOf, submissions } from "./submissions.mjs";
import { readThreads, threads } from "./threads.mjs";
import { uploads } from "./uploads.mjs";

// tabOpen returns whether a pair tab on this machine polled the hub
// recently. peer returns another session on the hub by its ID, which a
// linked session uses to reach its parent.
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
        roundStartedAt: timestamp(),
        updatedAt: timestamp(),
      };
  requireValue(
    idPattern.test(state.sessionId) && Array.isArray(state.acknowledged),
    "Invalid session state",
  );
  // Another program can write a status.json whose current.round is not a
  // string, and loadSession opens only pair's own format.
  requireValue(
    !state.current || typeof state.current.round === "string",
    `${directory} is not a pair session, so pair does not open it. Start a new session.`,
  );
  // The frame numbers sessions in the order they started. A session created
  // before pair wrote startedAt gets its directory's creation time, because
  // no later write changes that time.
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
  // The wake target contains a token or a socket path, so the hub stores it
  // in wake.json and never sends it in a browser response.
  const wakeFile = path.join(directory, "wake.json");
  const transition = async (patch) => {
    const next = { ...state, ...patch, updatedAt: timestamp() };
    await atomic(stateFile, next);
    state = next;
    return state;
  };
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
  // A closed session stays closed even with unread feedback. A pending Start
  // leaves the stage as it is, because answersRound excludes it.
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
  const title = () =>
    state.current ? state.current.title : state.title || "New session";
  const active = () => state.stage !== "complete" && !state.paused;
  // Each session module, such as uploads or rounds, adds its functions to
  // this object and calls the other modules' functions through it, so the
  // order in which loadSession creates the modules does not matter.
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
    await draftStore(session),
    links(session),
    quiet(session),
  );
  function view() {
    const { roundPages, holder, formerHolders, ...visible } = state;
    return {
      ...visible,
      // The holder's identity is a socket path or a thread ID, so view
      // leaves it out, like the rest of the wake target. The frame cannot
      // import the adapters, so view adds the CLI's name. sendWake sets
      // steerable from the last wake, and it is true when the agent CLI reads
      // a message in the middle of a turn.
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
  // The frame draws every thread's card from browserView. An agent reads a
  // thread with pair read --thread, so the status that pair commands print
  // leaves the threads out.
  function browserView() {
    return {
      ...view(),
      sessionDir: directory,
      threads: session.threadView(),
      parent: session.parentView(),
      draftId: session.draftView().id,
      draftRevision: session.draftView().revision,
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
              answersRound(item) && item.payload.round === requestedRound,
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
    const { groups, round, message } = event.payload;
    return {
      id: event.id,
      round,
      receivedAt: event.receivedAt,
      next: nextOf(event.payload),
      ...(message ? { message } : {}),
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
  function listing() {
    const round = state.current?.round ?? null;
    const set = state.roundPages?.[round];
    return {
      id: state.sessionId,
      title: title(),
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
      // readyPages lists the current round's published pages until the
      // reviewer sends feedback on it, so the frame can count the pages that
      // this browser has not opened.
      readyPages: {
        round,
        ids:
          set && state.latestSubmissionRound !== round
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
      events: session.withAcknowledgements(session.activityItems()),
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
    parentView: session.parentView,
    linkParent: session.linkParent,
    linkable: session.linkable,
    linkSession: session.linkSession,
    joinedInto: session.joinedInto,
    closedSession: session.closedSession,
    built: session.built,
    proposalItems: session.proposalItems,
    writeStatus: session.writeStatus,
    startThread: session.startThread,
    addThreadMessage: session.addThreadMessage,
    acknowledge: session.acknowledge,
    act: session.act,
    draftView: session.draftView,
    changeDraft: session.changeDraft,
    browserView,
    latestFeedback,
    listing,
    active,
    hold: session.hold,
    wakeIfQuiet: session.wakeIfQuiet,
    roundEntry: session.roundEntry,
    pageSet: session.pageSet,
    pageRecord: session.pageRecord,
    prototype: session.prototype,
  };
}
