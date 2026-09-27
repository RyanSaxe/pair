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
import { agent } from "./agent.mjs";
import { rounds } from "./rounds.mjs";
import { submissions } from "./submissions.mjs";
import { uploads } from "./uploads.mjs";

export async function loadSession(directory, config, origin) {
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
  for (const child of ["rounds", "feedback", "uploads", "scenes"])
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
  }
  async function pending() {
    return events
      .filter((event) => !state.acknowledged.includes(event.id))
      .sort((a, b) => a.sequence - b.sequence);
  }
  // A saved round keeps its acceptance unread until an agent reads it, and
  // stays saved.
  if ((await pending()).length && state.stage !== "saved")
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
    base,
    exclusive,
    transition,
    events,
    saveEvent,
    pending,
    sameRound,
    view,
    wakeFile,
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
  );
  function view() {
    const { roundPages, holder, formerHolders, ...visible } = state;
    return {
      ...visible,
      // The holder's identity is a socket path or a thread ID, which stays
      // out of the browser like the rest of the wake target.
      holder: holder ? { harness: holder.harness, at: holder.at } : null,
      handoff: session.handoff,
      ...(state.openRound
        ? {
            openRound: {
              round: state.openRound.round,
              pages: state.openRound.pages.map(({ id, title, state }) => ({
                id,
                title,
                state,
              })),
            },
          }
        : {}),
      rounds: state.rounds || [],
      wake: state.wake || null,
      paused: state.paused || null,
      needsYou: needsYou(),
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
  function listing() {
    if (!state.current) return null;
    return {
      id: state.sessionId,
      title: state.current.title,
      offer: state.current.offer,
      round: state.current.round,
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
      paused: Boolean(state.paused),
      publishedAt: state.current.publishedAt,
      updatedAt: state.updatedAt,
      url: base + "/",
    };
  }
  return {
    token,
    base,
    get id() {
      return state.sessionId;
    },
    get state() {
      return state;
    },
    exclusive,
    pending,
    submit: session.submit,
    upload: session.upload,
    readUpload: session.readUpload,
    uploadScene: session.uploadScene,
    readScene: session.readScene,
    removeUpload: session.removeUpload,
    dismiss: session.dismiss,
    act: session.act,
    view,
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
