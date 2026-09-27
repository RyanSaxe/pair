import { execFile, execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import * as claudeCode from "../adapters/claude-code/wake.mjs";
import * as codex from "../adapters/codex/wake.mjs";
import * as copilot from "../adapters/copilot/wake.mjs";
import { choiceText } from "./frame/choices.mjs";
import { guideFile } from "./guide.mjs";
import { offers } from "./offers.mjs";

// Each agent CLI wakes through its adapter, keyed by the harness name a wake
// target carries. With no agent CLI among the ancestors, the first adapter
// whose variables are set decides, in this order.
const adapters = { copilot, codex, "claude-code": claudeCode };
const here = fileURLToPath(import.meta.url);
const cli = path.join(path.dirname(here), "cli.mjs");
// The hub runs this file, guide.mjs, offers.mjs and the adapters, so a change
// to any of them restarts it.
export const version = [
  here,
  fileURLToPath(new URL("./guide.mjs", import.meta.url)),
  fileURLToPath(new URL("./offers.mjs", import.meta.url)),
  ...Object.keys(adapters).map((name) =>
    fileURLToPath(new URL(`../adapters/${name}/wake.mjs`, import.meta.url)),
  ),
]
  .reduce(
    (hash, file) => hash.update(readFileSync(file)),
    crypto.createHash("sha256"),
  )
  .digest("hex")
  .slice(0, 12);
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const roundPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const configScript =
  /(<script\b(?=[^>]*\bid=["']session-config["'])[^>]*>)[\s\S]*?(<\/script>)/i;
const json = (value) => JSON.stringify(value, null, 2);
const exists = async (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );
const read = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const timestamp = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function requireValue(condition, message, code = 400) {
  if (!condition) throw Object.assign(new Error(message), { statusCode: code });
}
async function atomic(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, json(value), { mode: 0o600 });
  await fs.rename(temporary, file);
}
function embedConfig(html, config) {
  const script = json(config).replaceAll("<", "\\u003c");
  return html.replace(
    configScript,
    () =>
      `<script type="application/json" id="session-config">${script}</script>`,
  );
}

export function settings(env = process.env) {
  const home = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  const root = path.join(home, "pair");
  const port =
    env.PAIR_HUB_PORT === undefined ? 4747 : Number(env.PAIR_HUB_PORT);
  requireValue(
    Number.isInteger(port) && port >= 0 && port <= 65535,
    "PAIR_HUB_PORT must be a port number",
  );
  const seconds = (name, fallback) => {
    if (env[name] === undefined) return fallback;
    const value = Number(env[name]);
    requireValue(
      Number.isFinite(value) && value >= 0,
      `${name} must be a number of seconds`,
    );
    return value;
  };
  return {
    root,
    sessions: path.join(root, "sessions"),
    hubDir: path.join(root, "hub"),
    hubFile: path.join(root, "hub", "hub.json"),
    hubLog: path.join(root, "hub", "hub.log"),
    port,
    host: env.PAIR_HUB_HOST || null,
    idleMs: seconds("PAIR_HUB_IDLE_SECONDS", 900) * 1000,
  };
}

export function readPlanData(html) {
  const match = html.match(
    /<script\b(?=[^>]*\bid=["']plan-data["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i,
  );
  requireValue(
    match,
    'HTML requires an application/json script with id="plan-data"',
  );
  return validPlan(JSON.parse(match[1]));
}
function validPlan(data) {
  requireValue(idPattern.test(data.name || ""), "Invalid name");
  requireValue(roundPattern.test(data.round || ""), "Invalid round");
  requireValue(
    data.offer === undefined || offerFor(data.offer),
    `Unknown offer ${JSON.stringify(data.offer)}. The offers are ${Object.keys(offers).join(", ")}.`,
  );
  requireValue(
    typeof data.title === "string" && data.title.trim(),
    "title is required",
  );
  requireValue(
    Array.isArray(data.pages) &&
      (data.pages.length > 0 || data.pageMode === "partial"),
    "At least one page is required",
  );
  const ids = new Set();
  if (data.agreements !== undefined) {
    requireValue(Array.isArray(data.agreements), "agreements must be an array");
    const agreementIds = new Set();
    for (const entry of data.agreements) {
      requireValue(
        entry &&
          typeof entry.id === "string" &&
          idPattern.test(entry.id) &&
          !agreementIds.has(entry.id),
        "Agreement IDs must be valid and unique",
      );
      agreementIds.add(entry.id);
      requireValue(
        ["title", "html"].every(
          (key) => typeof entry[key] === "string" && entry[key].trim(),
        ),
        "Agreements require title and html",
      );
      requireValue(
        (typeof entry.source === "string" && entry.source.trim()) ||
          (Array.isArray(entry.sourceRefs) && entry.sourceRefs.length > 0),
        "Agreements require source text or sourceRefs",
      );
      if (entry.sourceRefs !== undefined) {
        requireValue(
          Array.isArray(entry.sourceRefs),
          "sourceRefs must be an array",
        );
        for (const ref of entry.sourceRefs) {
          requireValue(
            ref &&
              ["note", "choice", "answer", "conversation"].includes(ref.kind),
            "Invalid source reference kind",
          );
          if (ref.kind === "conversation")
            requireValue(
              typeof ref.text === "string" && ref.text.trim(),
              "Conversation source requires text",
            );
          else {
            requireValue(
              idPattern.test(ref.submissionId || ""),
              "Invalid source submission ID",
            );
            const key = sourceItemKey(ref.kind);
            requireValue(
              typeof ref[key] === "string" && ref[key].length > 0,
              "Source reference requires an item ID",
            );
          }
        }
      }
      requireValue(
        entry.state === undefined ||
          ["agreed", "reopened", "retired"].includes(entry.state),
        "Invalid agreement state",
      );
      requireValue(
        entry.change === undefined || ["new", "updated"].includes(entry.change),
        "Invalid agreement change",
      );
      if (entry.href !== undefined) {
        requireValue(
          typeof entry.href === "string" && entry.href.trim(),
          "Invalid agreement source URL",
        );
        const url = new URL(entry.href, "http://127.0.0.1/");
        requireValue(
          ["http:", "https:"].includes(url.protocol),
          "Unsafe agreement source URL",
        );
      }
    }
  }
  const prototypeIds = new Set();
  if (data.prototypes !== undefined) {
    requireValue(Array.isArray(data.prototypes), "prototypes must be an array");
    for (const prototype of data.prototypes) {
      requireValue(
        prototype &&
          idPattern.test(prototype.id || "") &&
          !prototypeIds.has(prototype.id),
        "Prototype IDs must be valid and unique",
      );
      prototypeIds.add(prototype.id);
      requireValue(
        typeof prototype.title === "string" &&
          prototype.title.trim() &&
          typeof prototype.html === "string" &&
          prototype.html.trim(),
        "Prototypes require title and HTML",
      );
      requireValue(
        Number.isFinite(prototype.height) && prototype.height > 0,
        "Prototype height must be positive",
      );
    }
  }
  for (const page of data.pages) {
    requireValue(
      idPattern.test(page.id || "") &&
        !["agreed", "feedback"].includes(page.id) &&
        !ids.has(page.id),
      "Page IDs must be unique; agreed and feedback are reserved",
    );
    requireValue(
      typeof page.title === "string" &&
        page.title.trim() &&
        typeof page.html === "string",
      "Pages require title and html",
    );
    ids.add(page.id);
  }
  if (data.task !== undefined) validTask(data.task);
  for (const content of [...data.pages, ...(data.agreements || [])]) {
    for (const match of content.html.matchAll(
      /<[a-z][^>]*?\sdata-prototype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    ))
      requireValue(
        prototypeIds.has(match[1] ?? match[2] ?? match[3]),
        "Unknown prototype reference",
      );
  }
  if (data.pageMode !== "partial")
    requireFirstPage(data.offer, data.pages[0].id);
  return data;
}
function offerFor(id) {
  return typeof id === "string" && Object.hasOwn(offers, id)
    ? offers[id]
    : null;
}
const actionOf = ({ offer, action }) =>
  offers[offer].accept.actions.find((item) => item.id === action);
// The holder is the agent the hub wakes, named the way its adapter tells
// one session of its agent CLI from another.
const identify = (target) => ({
  harness: target.harness,
  id: adapters[target.harness].identity(target),
});
const sameAgent = (a, b) => a?.harness === b?.harness && a?.id === b?.id;
// A round that makes an offer opens on the page the offer names, such as a
// plan's overview.
function requireFirstPage(offer, id) {
  const first = offerFor(offer)?.firstPage;
  requireValue(
    !first || id === first,
    `A round that offers ${offer} lists ${first} first`,
  );
}
// The task opens Agreed: what the plan is building towards, in a title and a
// few sentences.
function validTask(task) {
  requireValue(
    task && typeof task === "object" && !Array.isArray(task),
    'page "agreed": Agreed has no task. State what the plan is building towards.',
  );
  requireValue(
    typeof task.title === "string" && task.title.trim(),
    'page "agreed": the task has no title',
  );
  requireValue(
    typeof task.html === "string" && task.html.trim(),
    'page "agreed": the task has no text',
  );
  requireValue(
    task.change === undefined || ["new", "updated"].includes(task.change),
    'page "agreed": the task\'s change is new or updated',
  );
}
export function pageData(html) {
  const match = html.match(
    /<script\b(?=[^>]*\bid=["']page-data["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i,
  );
  let record;
  try {
    record = JSON.parse(match ? match[1] : html);
  } catch {
    requireValue(false, "Invalid page record");
  }
  return validPage(record);
}
export function validPage(record) {
  const page = record?.page;
  requireValue(page && typeof page === "object", "Page record requires page");
  requireValue(
    idPattern.test(page.id || "") && page.id !== "feedback",
    "Invalid page ID",
  );
  requireValue(
    typeof page.title === "string" && page.title.trim(),
    "Page title is required",
  );
  requireValue(
    page.id === "agreed"
      ? Array.isArray(page.agreements)
      : typeof page.html === "string" && page.html.trim(),
    "Agreed requires agreements; other pages require HTML",
  );
  if (page.id === "agreed") validTask(page.task);
  for (const key of ["cssText", "jsText"])
    requireValue(
      page[key] === undefined || typeof page[key] === "string",
      `${key} must be text`,
    );
  if (page.jsText)
    requireValue(
      /export\s+(?:async\s+)?function\s+setup\s*\(/.test(page.jsText),
      "Page JavaScript must export setup(root, planUI)",
    );
  if (
    /<\/style/i.test(page.cssText || "") ||
    /<\/script/i.test(page.jsText || "")
  )
    requireValue(false, "Page CSS/JS cannot contain closing style/script tags");
  validPlan(pagePlan(record));
  return record;
}
// A page record as plan data on its own: Agreed carries the agreements and
// the task, and any other page carries itself.
export function pagePlan({ page, ...record }) {
  const agreed = page.id === "agreed";
  return {
    name: record.name,
    round: record.round,
    offer: record.offer,
    title: record.title,
    pageMode: "partial",
    pages: agreed ? [] : [{ id: page.id, title: page.title, html: page.html }],
    agreements: agreed ? page.agreements : [],
    task: agreed ? page.task : undefined,
    prototypes: page.prototypes || [],
  };
}
function pageList(items, offer) {
  requireValue(
    Array.isArray(items) && items.length > 0,
    "List at least one page",
  );
  const ids = new Set();
  for (const item of items) {
    requireValue(
      item &&
        idPattern.test(item.id || "") &&
        !["agreed", "feedback"].includes(item.id) &&
        !ids.has(item.id) &&
        typeof item.title === "string" &&
        item.title.trim(),
      "Page IDs and titles must be valid and unique",
    );
    ids.add(item.id);
  }
  requireFirstPage(offer, items[0].id);
  return items.map(({ id, title }) => ({
    id,
    title,
    state: "queued",
    version: null,
  }));
}
// Agreed lists the decisions that changed most recently first, and keeps the
// agent's order among decisions that changed in the same round.
function orderAgreements(entries, earlier) {
  const byId = new Map(earlier.map((entry) => [entry.id, entry]));
  const next =
    Math.max(0, ...earlier.map((entry) => entry.lastChangedOrder || 0)) + 1;
  entries.forEach((entry, index) => {
    const old = byId.get(entry.id);
    const same =
      old &&
      ["title", "html", "state"].every(
        (key) => (old[key] || null) === (entry[key] || null),
      );
    entry.lastChangedOrder = same ? old.lastChangedOrder || 0 : next;
    entry.authoredOrder = index;
  });
  entries.sort(
    (a, b) =>
      b.lastChangedOrder - a.lastChangedOrder ||
      a.authoredOrder - b.authoredOrder,
  );
}
function sourceItemKey(kind) {
  return { note: "noteId", choice: "choiceId", answer: "answerId" }[kind];
}
function sourceItem(payload, ref) {
  if (ref.kind === "note")
    return payload.groups?.notes?.find((note) => note.id === ref.noteId);
  if (ref.kind === "choice") return payload.groups?.choices?.[ref.choiceId];
  return payload.groups?.answers?.[ref.answerId];
}

// Every event carries groups, which are often empty. An acceptance record
// keeps them only when they hold a note, a choice or an answer.
function heldItems(groups) {
  return (
    Boolean(groups) &&
    ((Array.isArray(groups.notes) && groups.notes.length > 0) ||
      Object.keys(groups.choices || {}).length > 0 ||
      Object.keys(groups.answers || {}).length > 0)
  );
}

function serializer() {
  let queue = Promise.resolve();
  return (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
}

async function loadSession(directory, config, origin) {
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
  async function events() {
    const files = (await fs.readdir(path.join(directory, "feedback"))).filter(
      (name) => name.endsWith(".json"),
    );
    return Promise.all(
      files.map((name) => read(path.join(directory, "feedback", name))),
    );
  }
  const sequence = (await events()).reduce(
    (last, event) => Math.max(last, event.sequence),
    0,
  );
  async function pending() {
    return (await events())
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
    pending,
    sameRound,
    view,
    wakeFile,
    wake: (await exists(wakeFile)) ? await read(wakeFile) : null,
    sequence,
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
      ? (await events())
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

// What the reviewer sends: feedback and acceptances.
function submissions(session) {
  const { directory, transition, pending, sameRound, exclusive, view } =
    session;
  function withDrawingPaths(event) {
    const answers = event.payload.groups?.answers;
    if (
      !answers ||
      !Object.values(answers).some((item) => item.kind === "drawing")
    )
      return event;
    const mapped = Object.fromEntries(
      Object.entries(answers).map(([key, answer]) => [
        key,
        answer.kind === "drawing"
          ? {
              ...answer,
              scenePath: path.join(
                directory,
                "scenes",
                `${answer.sceneId}.excalidraw`,
              ),
              previewPath: path.join(
                directory,
                "uploads",
                `${answer.previewId}.png`,
              ),
            }
          : answer,
      ]),
    );
    return {
      ...event,
      payload: {
        ...event.payload,
        groups: { ...event.payload.groups, answers: mapped },
      },
    };
  }
  async function submit(data) {
    requireValue(
      data.sessionId === session.state.sessionId,
      "Wrong session",
      409,
    );
    requireValue(
      idPattern.test(data.id || "") &&
        typeof data.text === "string" &&
        data.text.trim(),
      "Submission requires ID and text",
    );
    requireValue(
      ["feedback-only", "accept"].includes(data.intent),
      "Invalid submission intent",
    );
    requireValue(
      data.groups &&
        typeof data.groups === "object" &&
        !Array.isArray(data.groups),
      "groups must be an object",
    );
    if (
      data.intent === "feedback-only" &&
      data.groups.alignUnflagged !== undefined
    )
      requireValue(
        typeof data.groups.alignUnflagged === "boolean",
        "alignUnflagged must be a boolean",
      );
    if (data.groups.answers !== undefined) {
      requireValue(
        data.groups.answers &&
          typeof data.groups.answers === "object" &&
          !Array.isArray(data.groups.answers),
        "answers must be an object",
      );
      for (const answer of Object.values(data.groups.answers)) {
        if (answer?.kind === "drawing") {
          requireValue(
            ["label", "topic", "round", "sceneId", "previewId"].every(
              (key) => typeof answer[key] === "string" && answer[key],
            ),
            "Drawing answers require label, topic, round and both file IDs",
          );
          await session.readScene(answer.sceneId);
          const preview = await session.readUpload(answer.previewId);
          requireValue(
            preview.type === "image/png",
            "Drawing preview must be PNG",
          );
        } else
          requireValue(
            answer &&
              answer.kind === undefined &&
              ["label", "text", "topic"].every(
                (key) => typeof answer[key] === "string",
              ) &&
              answer.text.trim(),
            "Answers require label, text, and topic",
          );
      }
    }
    /* Images hang off the note they illustrate, and a note may only name an
       image this session holds, so a submission cannot point the agent at a
       path the hub never wrote. */
    if (Array.isArray(data.groups.notes)) {
      const held = new Set(
        (await fs.readdir(path.join(directory, "uploads"))).map((name) =>
          name.slice(0, name.indexOf(".")),
        ),
      );
      for (const note of data.groups.notes) {
        if (note?.attachments === undefined) continue;
        requireValue(
          Array.isArray(note.attachments),
          "A note's attachments must be an array",
        );
        for (const item of note.attachments) {
          requireValue(
            item &&
              typeof item.id === "string" &&
              typeof item.path === "string" &&
              typeof item.type === "string" &&
              Number.isInteger(item.bytes),
            "An attachment needs id, path, type and bytes",
          );
          requireValue(
            held.has(item.id),
            `Image ${item.id} is not in this session`,
          );
        }
      }
    }
    if (data.intent === "accept") {
      const accept = offerFor(data.offer)?.accept;
      requireValue(
        accept?.actions.some((action) => action.id === data.action),
        "An acceptance names an offer and one of its actions",
      );
      if (data.guidance !== undefined) {
        requireValue(
          data.action === accept.guidance.action &&
            typeof data.guidance === "string",
          `Only ${accept.guidance.action} takes guidance`,
        );
        data.guidance = data.guidance.trim();
        requireValue(
          data.guidance.length <= 4000,
          "Guidance exceeds 4,000 characters",
        );
        if (!data.guidance) delete data.guidance;
      }
    }
    const file = path.join(directory, "feedback", data.id + ".json");
    if (await exists(file)) {
      const original = await read(file);
      requireValue(
        isDeepStrictEqual(original.payload, data),
        "Submission ID already has different content",
        409,
      );
      return { id: data.id, saved: true, status: view() };
    }
    requireValue(
      sameRound(data),
      "Review the current round before submitting; export older drafts if needed",
      409,
    );
    if (data.intent === "accept") {
      requireValue(
        data.offer === session.state.current.offer,
        `Round ${session.state.current.round} does not offer ${data.offer}`,
        409,
      );
      requireValue(
        ["ready", "updated"].includes(session.state.stage) &&
          !(await pending()).length,
        "Resolve feedback before accepting the current round",
        409,
      );
    }
    requireValue(
      !session.state.openRound,
      "Finish every listed page before submitting feedback",
      409,
    );
    await atomic(file, {
      id: data.id,
      sequence: ++session.sequence,
      receivedAt: timestamp(),
      payload: data,
    });
    const after = data.intent === "accept" ? actionOf(data).after : null;
    await transition({
      stage:
        after === "saved"
          ? "saved"
          : data.intent === "feedback-only" && session.state.stage === "working"
            ? "working"
            : "submitted",
      latestSubmissionId: data.id,
      // The round of a submission the agent answers with its next round.
      // The frame shows the agent's progress until that round is complete.
      latestSubmissionRound:
        data.intent === "feedback-only" || after === "round"
          ? data.round
          : null,
      wake: session.state.wake ? { ...session.state.wake, last: null } : null,
      accepted: null,
      takeover: null,
    });
    if (session.wake && !session.state.paused)
      setTimeout(() => exclusive(() => session.wakeAgent(data.round)), 0);
    return { id: data.id, saved: true, status: view() };
  }
  return { withDrawingPaths, submit };
}

// Images and drawing scenes the reviewer adds to a session.
function uploads(session) {
  const { directory } = session;
  /* The hub names every file, so a caller never chooses a path and a name
     can never escape the uploads directory. */
  async function upload(bytes) {
    const kind = imageKind(bytes);
    requireValue(kind, "Only PNG, JPEG, WebP and GIF images are accepted", 415);
    const id = crypto.randomBytes(8).toString("hex");
    const file = path.join(directory, "uploads", `${id}.${kind.ext}`);
    await fs.writeFile(file, bytes, { mode: 0o600 });
    return { id, path: file, type: kind.type, bytes: bytes.length };
  }
  async function readUpload(id) {
    requireValue(/^[0-9a-f]{16}$/.test(id || ""), "Bad image ID", 404);
    const held = await fs.readdir(path.join(directory, "uploads"));
    const name = held.find((entry) => entry.startsWith(`${id}.`));
    requireValue(name, "No such image", 404);
    const bytes = await fs.readFile(path.join(directory, "uploads", name));
    const kind = imageKind(bytes);
    requireValue(kind, "No such image", 404);
    return { bytes, type: kind.type };
  }
  async function uploadScene(bytes) {
    let scene;
    try {
      scene = JSON.parse(bytes.toString("utf8"));
    } catch {
      requireValue(false, "Drawing scene must be JSON");
    }
    requireValue(
      scene?.type === "excalidraw" &&
        Array.isArray(scene.elements) &&
        scene.elements.length > 0 &&
        scene.appState &&
        typeof scene.appState === "object" &&
        !Array.isArray(scene.appState) &&
        scene.files &&
        typeof scene.files === "object" &&
        !Array.isArray(scene.files),
      "Drawing scene must contain Excalidraw elements, appState and files",
    );
    const id = crypto.randomBytes(8).toString("hex");
    const file = path.join(directory, "scenes", `${id}.excalidraw`);
    await fs.writeFile(file, bytes, { mode: 0o600 });
    return {
      id,
      path: file,
      type: "application/vnd.excalidraw+json",
      bytes: bytes.length,
    };
  }
  async function readScene(id) {
    requireValue(/^[0-9a-f]{16}$/.test(id || ""), "Bad drawing scene ID", 404);
    const file = path.join(directory, "scenes", `${id}.excalidraw`);
    requireValue(await exists(file), "No such drawing scene", 404);
    return { bytes: await fs.readFile(file), path: file };
  }
  /* A note the reviewer removed takes its images with it. */
  async function removeUpload(id) {
    requireValue(/^[0-9a-f]{16}$/.test(id || ""), "Bad image ID");
    const held = await fs.readdir(path.join(directory, "uploads"));
    const name = held.find((entry) => entry.startsWith(`${id}.`));
    if (name) await fs.rm(path.join(directory, "uploads", name));
    return { id, removed: Boolean(name) };
  }
  return { upload, readUpload, uploadScene, readScene, removeUpload };
}

// The agent's commands, the holder, and the lines that tell the agent what
// to do next.
function agent(session) {
  const { directory, config, transition, pending, sameRound, view } = session;
  const command = (name) => `pair ${name} --session-dir ${directory}`;
  // Any agent in any harness takes the session over with this line.
  const handoff = `Take over pair session ${directory}: run ${command("start")} and follow what it prints.`;
  // Each agent command is a report, and the reviewer sees when the last one
  // came. Only ack carries a note, so any other report clears the last one.
  const report = (note = null) => ({ report: { at: timestamp(), note } });
  const receive = (event) =>
    event && session.state.lastReceivedId !== event.id
      ? { lastReceivedId: event.id, receivedAt: timestamp() }
      : {};
  const guide = (name) => guideFile(name, config.root);
  const offerGuide = (id) => guide(path.relative("guide", offers[id].guide));
  const actionAfter = (offer, after) =>
    offers[offer].accept.actions.find((item) => item.after === after);
  // Every agent command prints the step after it, so an agent that lost its
  // place, or skipped round.md, is told where the session stands.
  async function nextStep() {
    const [event] = await pending();
    if (event)
      return event.payload.intent === "accept"
        ? `Read ${await offerGuide(event.payload.offer)}, then run: ${command("read")}`
        : `Read ${await guide("round.md")} in full, then run: ${command("read")}`;
    if (session.state.stage === "complete") return "The session is complete.";
    if (session.state.stage === "saved") {
      const { round, offer } = session.state.current;
      return `Round ${round} is saved for later, as the ${actionAfter(offer, "saved").id} action in ${await offerGuide(offer)} describes. Say this line in chat, then end your turn: ${handoff}`;
    }
    if (session.state.accepted) {
      const { round, offer } = session.state.accepted;
      const action = actionOf(session.state.accepted);
      // A start on the saved round sent this agent on to build it.
      if (action.after === "saved")
        return `Round ${round} was saved for later, and you are building it now. Build it as the ${actionAfter(offer, "round").id} action in ${await offerGuide(offer)} describes.`;
      return `Follow the ${action.id} action in ${await offerGuide(offer)}.`;
    }
    if (session.state.paused)
      return `The session is paused. Tell the user, and resume it with: ${command("start")}`;
    if (!session.state.current)
      return `When the first round is ready, publish Agreed with pair publish --pages before any other page, as ${await guide("round.md")} describes.`;
    if (session.state.openRound) {
      const left = session.state.openRound.pages
        .filter((slot) => !slot.recordPath)
        .map((slot) =>
          slot.state === "active" ? `${slot.id} (started)` : slot.id,
        );
      return `Pages still to publish: ${left.join(", ")}. Run pair progress --start ID as you begin a page, run pair publish as soon as it builds, and report with pair ack --note at least every 5 minutes.`;
    }
    if (session.state.stage === "working")
      return `Update the task and Agreed from the feedback, then publish Agreed with pair publish --pages before any other page, as ${await guide("round.md")} describes. Report with pair ack --note at least every 5 minutes.`;
    return "The round is with the reviewer. Say in chat what changed if you have not, then end the turn. The hub wakes you when they submit.";
  }
  // Runs after the submission is saved, outside the browser's request, so a
  // slow or failing harness never delays the reviewer's Sent session.state.
  async function wakeAgent(round) {
    const line = `pair: feedback arrived on session ${directory} (Round ${round}). Run first: ${command("ack")}. It prints the next step.`;
    let last;
    try {
      await (config.wake || wakeRunner)(session.wake, line);
      last = { at: timestamp(), ok: true };
    } catch (error) {
      last = { at: timestamp(), ok: false, reason: error.message };
    }
    await transition({ wake: { harness: session.wake.harness, last } });
  }
  /* Closing a session from the browser. complete() refuses without an
     acceptance, so ending an abandoned session needs its own door. */
  async function dismiss() {
    await transition({ stage: "complete", dismissedAt: timestamp() });
    return { status: view() };
  }
  // The next command of an agent the session was taken from fails, start
  // included, so it stops instead of publishing over its successor. After
  // that it is told, like any agent that does not hold the session, how to
  // take the session over, which it does only when the user asks.
  async function requireHolder(agent, start = false) {
    const clock = (at) => new Date(at).toTimeString().slice(0, 5);
    const former = (session.state.formerHolders || []).find((item) =>
      sameAgent(item, agent),
    );
    if (former) {
      await transition({
        formerHolders: session.state.formerHolders.filter(
          (item) => item !== former,
        ),
      });
      requireValue(
        false,
        `Another agent took this session over at ${clock(former.until)}. Stop working on it.`,
        409,
      );
    }
    if (
      !start &&
      session.state.holder &&
      !sameAgent(session.state.holder, agent)
    )
      requireValue(
        false,
        `Another agent has held this session since ${clock(session.state.holder.at)}. Stop working on it unless the user asks you to take it over with: ${command("start")}`,
        409,
      );
  }
  async function act(data) {
    requireValue(
      data.sessionId === session.state.sessionId,
      "Wrong session",
      409,
    );
    await requireHolder(data.agent);
    if (data.action === "status") return { status: view() };
    if (data.action === "read") {
      // With an id, read returns that submission again and changes nothing,
      // for a turn that resumes after an interruption.
      if (data.id !== undefined) {
        requireValue(idPattern.test(data.id || ""), "Submission ID required");
        const event = await read(
          path.join(directory, "feedback", data.id + ".json"),
        );
        return {
          status: view(),
          event: session.withDrawingPaths(event),
          next: await nextStep(),
        };
      }
      const [event] = await pending();
      if (!event)
        return { status: view(), event: null, next: await nextStep() };
      const patch = {
        ...report(),
        ...receive(event),
        stage: session.state.stage === "saved" ? "saved" : "working",
        acknowledged: [...session.state.acknowledged, event.id],
        acknowledgedAt: timestamp(),
        lastAcknowledgedId: event.id,
      };
      if (event.payload.intent === "accept") {
        requireValue(
          sameRound(event.payload),
          "Acceptance no longer matches the current round",
          409,
        );
        patch.accepted = {
          eventId: event.id,
          ...session.state.current,
          action: event.payload.action,
          ...(event.payload.guidance
            ? { guidance: event.payload.guidance }
            : {}),
          ...(heldItems(event.payload.groups)
            ? { groups: event.payload.groups }
            : {}),
          acceptedAt: event.receivedAt,
        };
        await atomic(path.join(directory, "acceptance.json"), patch.accepted);
      }
      await transition(patch);
      return {
        status: view(),
        event: session.withDrawingPaths(event),
        next: await nextStep(),
      };
    }
    if (data.action === "ack") {
      requireValue(
        data.note === undefined ||
          (typeof data.note === "string" && data.note.trim().length <= 80),
        "An ack note is text of at most 80 characters",
      );
      const [event] = await pending();
      await transition({
        ...report(data.note?.trim() || null),
        ...receive(event),
      });
      return {
        status: view(),
        received: event ? { id: event.id, intent: event.payload.intent } : null,
        next: await nextStep(),
      };
    }
    if (data.action === "progress") {
      return session.pageProgress(data);
    }
    if (data.action === "pause") {
      requireValue(
        typeof data.reason === "string" && data.reason.trim(),
        "pause requires a reason",
      );
      await transition({
        paused: { at: timestamp(), reason: data.reason.trim() },
      });
      return { status: view() };
    }
    if (data.action === "publish")
      return session.publishPage(data.html, data.source, data.pages);
    if (data.action === "complete") {
      requireValue(
        session.state.accepted &&
          session.state.accepted.sha256 === session.state.current?.sha256 &&
          !(await pending()).length,
        "Acknowledge acceptance of the current round before completing",
        409,
      );
      const action = actionOf(session.state.accepted);
      if (action.after !== "complete")
        requireValue(
          false,
          `${action.label} keeps the session, so it does not complete. ${await nextStep()}`,
          409,
        );
      await transition({ stage: "complete" });
      return { status: view() };
    }
    requireValue(false, "Unknown agent action");
  }
  // pair start makes its agent the holder, the one agent the hub wakes. Any
  // other registration, such as a command reattaching to a new hub, comes
  // from the holder. start on a saved round builds it, unless the holder
  // has yet to read the Save: that start resumes an interrupted turn, which
  // reads the Save and says the handoff line. Once the Save is read, nothing
  // tells a resumed turn from a request to build, so start builds the plan in
  // any agent, the holder included, such as a new conversation in the same
  // Claude Code process.
  async function hold(target, start) {
    const agent = identify(target);
    const held = session.state.holder;
    const same = sameAgent(held, agent);
    const unread = (await pending()).length > 0;
    await requireHolder(agent, start);
    await atomic(session.wakeFile, target);
    session.wake = target;
    const patch = {
      wake: { harness: target.harness, last: session.state.wake?.last || null },
      paused: null,
    };
    if (!same) {
      patch.holder = { ...agent, at: timestamp() };
      // The reviewer's card says who took over, until they next submit.
      if (held)
        Object.assign(patch, report(), {
          takeover: { name: adapters[agent.harness].name, at: patch.holder.at },
          wake: { harness: target.harness, last: null },
          formerHolders: [
            ...(session.state.formerHolders || []),
            { harness: held.harness, id: held.id, until: patch.holder.at },
          ],
        });
    }
    // A build clears the failed wake of the Save, so the card follows the
    // build and not a harness that had exited.
    const build = start && session.state.stage === "saved" && !(same && unread);
    if (build)
      Object.assign(patch, report(), {
        stage: "working",
        latestSubmissionRound: session.state.current.round,
        wake: { harness: target.harness, last: null },
      });
    await transition(patch);
    return build ? buildNext(unread) : null;
  }
  // The acceptance keeps its save action, so the line says outright that
  // this agent builds the plan.
  async function buildNext(unread) {
    const { round, offer } = session.state.current;
    const reading = unread
      ? command("read")
      : `${command("read")} --id ${session.state.accepted.eventId}`;
    return `Round ${round} was saved for later, and you now build it. Read ${await offerGuide(offer)}, then run: ${reading}. It prints the acceptance with the reviewer's comments, and its action stays ${actionAfter(offer, "saved").id}. Build the plan as the ${actionAfter(offer, "round").id} action describes.`;
  }
  return { handoff, report, nextStep, wakeAgent, dismiss, act, hold };
}

// Publishing a round's pages, and reading the rounds a session keeps.
function rounds(session) {
  const { directory, origin, base, transition, events, pending, view } =
    session;
  async function resolvePageAgreements(entries) {
    const submissions = await events();
    for (const entry of entries) {
      delete entry.sourceRecords;
      if (!entry.sourceRefs) continue;
      entry.sourceRecords = [];
      for (const ref of entry.sourceRefs) {
        if (ref.kind === "conversation") {
          entry.sourceRecords.push({ kind: ref.kind, text: ref.text });
          continue;
        }
        const event = submissions.find((item) => item.id === ref.submissionId);
        requireValue(event, "Source submission not found");
        const item = sourceItem(event.payload, ref);
        requireValue(
          item && typeof item.topic === "string",
          "Source item not found",
        );
        const text = ref.kind === "choice" ? choiceText(item) : item.text;
        const label = ref.kind === "note" ? item.anchor : item.label;
        requireValue(
          typeof text === "string" && typeof label === "string",
          "Source item has invalid content",
        );
        const target =
          typeof item.target === "string" && idPattern.test(item.target)
            ? item.target
            : null;
        const payload = event.payload;
        requireValue(
          idPattern.test(payload.name || "") &&
            roundPattern.test(payload.round || ""),
          "Invalid source round",
        );
        const href = `./${payload.name}.${payload.round}.html${target ? "?target=" + encodeURIComponent(target) : ""}#${encodeURIComponent(item.topic)}`;
        entry.sourceRecords.push({
          kind: ref.kind,
          submissionId: ref.submissionId,
          text,
          label,
          topic: item.topic,
          name: payload.name,
          round: payload.round,
          href,
          ...(target ? { target } : {}),
          ...(ref.kind === "choice" ? { choice: item } : {}),
          ...(typeof item.quote === "string" ? { quote: item.quote } : {}),
        });
      }
    }
  }
  const storedPagePath = (set, file) =>
    path.join(directory, "pages", set.round, path.basename(file));
  async function renderPageRound(set, complete) {
    const { assemble, pageScope, pageScripts } = await import("./build.mjs");
    const bundle = await read(storedPagePath(set, set.bundlePath));
    const agreed = await read(storedPagePath(set, set.agreed));
    const records = await Promise.all(
      set.pages
        .filter((slot) => slot.recordPath)
        .map((slot) => read(storedPagePath(set, slot.recordPath))),
    );
    const ready = new Map(
      records.map((record) => [record.page.id, record.page]),
    );
    const pages = set.pages.map((slot) => ({
      id: slot.id,
      title: slot.title,
      html: ready.get(slot.id)?.html || "",
      pending: !slot.recordPath,
      working: slot.state === "active",
    }));
    const all = [agreed.page, ...records.map((record) => record.page)];
    const css = all
      .filter((page) => page.cssText)
      .map(
        (page) =>
          `@scope (${pageScope(page.id, set.round)}) { ${page.cssText} }`,
      )
      .join("\n");
    const data = {
      name: set.name,
      round: set.round,
      offer: set.offer,
      title: set.title,
      ...(complete ? {} : { pageMode: "partial" }),
      pages,
      agreements: agreed.page.agreements,
      task: agreed.page.task,
      prototypes: all.flatMap((page) => page.prototypes || []),
    };
    return assemble(data, {
      css,
      js: pageScripts(all, set.round),
      allowUnknownPages: !complete,
      bundle,
    });
  }
  async function commitPageRound(set, source = null) {
    const complete = set.pages.every((slot) => slot.recordPath);
    let current = session.state.current;
    if (!current || current.round !== set.round || complete) {
      let html;
      try {
        html = await renderPageRound(set, complete);
      } catch (error) {
        error.statusCode ||= 400;
        throw error;
      }
      const stored = embedConfig(html, {
        sessionId: session.state.sessionId,
        base,
      });
      const name = complete
        ? `${set.name}.${set.round}.html`
        : `${set.name}.${set.round}.live.html`;
      const file = path.join(directory, "rounds", name);
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, stored, { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, file);
      current = {
        name: set.name,
        round: set.round,
        offer: set.offer,
        title: set.title,
        path: file,
        url: base + "/",
        sha256: crypto.createHash("sha256").update(stored).digest("hex"),
        publishedAt: timestamp(),
        source,
      };
    }
    const rounds = complete
      ? [
          ...(session.state.rounds || []),
          {
            name: set.name,
            round: set.round,
            offer: set.offer,
            title: set.title,
            publishedAt: current.publishedAt,
            url: `${base}/r/${encodeURIComponent(set.round)}`,
          },
        ]
      : session.state.rounds || [];
    await transition({
      ...session.report(),
      openRound: complete ? null : set,
      roundPages: { ...(session.state.roundPages || {}), [set.round]: set },
      pageSetGeneration: set.generation,
      stage: complete ? "updated" : "working",
      current,
      title: set.title,
      rounds,
      accepted: null,
    });
    return {
      status: view(),
      url: origin + current.url,
      roundComplete: complete,
      next: await session.nextStep(),
    };
  }
  async function publishPage(html, source, pages) {
    requireValue(
      !(await pending()).length,
      "Read pending feedback before publishing",
      409,
    );
    requireValue(
      ["ready", "working"].includes(session.state.stage),
      "Read feedback before publishing a page",
      409,
    );
    requireValue(
      source === undefined ||
        (typeof source === "string" &&
          path.resolve(source).startsWith(directory + path.sep)),
      "Source must be a directory inside the session directory",
    );
    requireValue(
      configScript.test(html),
      "HTML requires a session-config JSON script",
    );
    requireValue(
      /\bid=["']page-data["']/.test(html),
      "HTML requires a page-data JSON script",
    );
    const record = pageData(html);
    const { page } = record;
    requireValue(
      page.id === "agreed" || pages === undefined,
      "--pages is only valid when publishing Agreed",
    );
    let set;
    if (page.id === "agreed") {
      const slots = pageList(pages, record.offer);
      requireValue(
        !session.state.openRound,
        "Agreed is already published for this round",
        409,
      );
      requireValue(
        !(session.state.rounds || []).some(
          (item) => item.round === record.round,
        ),
        `Round ${record.round} is already used`,
        409,
      );
      await resolvePageAgreements(page.agreements);
      const previous = session.state.roundPages?.[session.state.current?.round];
      orderAgreements(
        page.agreements,
        previous?.agreed
          ? (await read(storedPagePath(previous, previous.agreed))).page
              .agreements
          : [],
      );
      set = {
        name: record.name,
        round: record.round,
        offer: record.offer,
        title: record.title,
        agreed: null,
        pages: slots,
        bundlePath: null,
        generation: 1,
      };
    } else {
      requireValue(
        session.state.openRound,
        "Publish Agreed before other pages",
        409,
      );
      set = structuredClone(session.state.openRound);
      requireValue(
        ["name", "round", "offer", "title"].every(
          (key) => record[key] === set[key],
        ),
        "Page does not match this round",
        409,
      );
      const slot = set.pages?.find((item) => item.id === page.id);
      requireValue(
        slot && slot.title === page.title,
        "Page is not in this round's list",
        409,
      );
      requireValue(!slot.recordPath, "Page is already published", 409);
      const used = new Set();
      for (const file of [
        set.agreed,
        ...set.pages
          .filter((item) => item.recordPath)
          .map((item) => item.recordPath),
      ])
        for (const item of (await read(storedPagePath(set, file))).page
          .prototypes || [])
          used.add(item.id);
      requireValue(
        !(page.prototypes || []).some((item) => used.has(item.id)),
        "Prototype ID is already used in this round",
        409,
      );
    }
    const recordDir = path.join(directory, "pages", record.round);
    await fs.mkdir(recordDir, { recursive: true, mode: 0o700 });
    const recordPath = path.join(
      recordDir,
      `${page.id}.${crypto.randomUUID()}.json`,
    );
    const recordBytes = json(record);
    await fs.writeFile(recordPath, recordBytes, { mode: 0o600, flag: "wx" });
    const version = crypto
      .createHash("sha256")
      .update(recordBytes)
      .digest("hex");
    if (page.id === "agreed") {
      set.agreed = recordPath;
      set.agreedVersion = version;
      // The round keeps the frame it started with, so an update to
      // pair mid-round cannot mix two frames in one built file.
      const { frameBundle } = await import("./build.mjs");
      set.bundlePath = path.join(
        recordDir,
        `frame.${crypto.randomUUID()}.json`,
      );
      await fs.writeFile(set.bundlePath, json(await frameBundle()), {
        mode: 0o600,
        flag: "wx",
      });
    } else {
      const slot = set.pages.find((item) => item.id === page.id);
      slot.recordPath = recordPath;
      slot.state = "ready";
      slot.version = version;
      set.generation++;
    }
    const result = await commitPageRound(set, source);
    return {
      ...result,
      page: {
        id: page.id,
        round: record.round,
        version,
        recordPath,
      },
    };
  }
  async function pageProgress(data) {
    requireValue(
      session.state.openRound && session.state.stage === "working",
      "Publish Agreed first",
      409,
    );
    const set = structuredClone(session.state.openRound);
    requireValue(
      data.pages === undefined &&
        data.done === undefined &&
        Array.isArray(data.start) &&
        data.start.length > 0,
      "Page progress only takes --start; publishing marks a page done",
    );
    for (const id of data.start) {
      const slot = set.pages.find((item) => item.id === id);
      requireValue(
        slot && !slot.recordPath,
        `Unknown or ready page ${id}`,
        409,
      );
      slot.state = "active";
    }
    set.generation++;
    return commitPageRound(set);
  }
  function roundEntry(round) {
    const entry = (session.state.rounds || []).find(
      (item) => item.round === round,
    );
    if (entry)
      return {
        ...entry,
        path: path.join(
          directory,
          "rounds",
          `${entry.name}.${entry.round}.html`,
        ),
      };
    if (session.state.current?.round === round) return session.state.current;
    return null;
  }
  function pageSet(round) {
    requireValue(roundPattern.test(round || ""), "Invalid round");
    const set = session.state.roundPages?.[round];
    requireValue(set, "Unknown round", 404);
    return {
      round,
      generation: set.generation,
      complete: set.pages.every((slot) => slot.recordPath),
      pages: [
        {
          id: "agreed",
          title: "Agreed so far",
          state: "ready",
          version: set.agreedVersion,
        },
        ...set.pages.map(({ id, title, state, version }) => ({
          id,
          title,
          state,
          version,
        })),
      ],
    };
  }
  async function pageRecord(round, id, version) {
    const manifest = pageSet(round);
    requireValue(
      idPattern.test(id || "") && /^[0-9a-f]{64}$/.test(version || ""),
      "Invalid page or version",
    );
    const slot = manifest.pages.find((item) => item.id === id);
    requireValue(slot && slot.version === version, "Unknown page version", 404);
    const set = session.state.roundPages[round];
    return read(
      storedPagePath(
        set,
        id === "agreed"
          ? set.agreed
          : set.pages.find((item) => item.id === id).recordPath,
      ),
    );
  }
  async function prototype(round, id) {
    requireValue(idPattern.test(id || ""), "Invalid prototype ID");
    const manifest = pageSet(round);
    for (const slot of manifest.pages.filter((item) => item.version)) {
      const record = await pageRecord(round, slot.id, slot.version);
      const item = record.page.prototypes?.find((entry) => entry.id === id);
      if (item) return item;
    }
    requireValue(false, "Unknown prototype", 404);
  }
  return {
    publishPage,
    pageProgress,
    roundEntry,
    pageSet,
    pageRecord,
    prototype,
  };
}

/* An image is identified by its leading bytes, not by a Content-Type a
   caller sets or an extension a name carries. Anything else is refused, so
   the hub never writes a file it could not name. */
const signatures = [
  {
    type: "image/png",
    ext: "png",
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { type: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  { type: "image/gif", ext: "gif", magic: [0x47, 0x49, 0x46, 0x38] },
];
function imageKind(bytes) {
  for (const entry of signatures)
    if (entry.magic.every((byte, at) => bytes[at] === byte)) return entry;
  // RIFF....WEBP: the four-byte size sits between the two markers.
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return { type: "image/webp", ext: "webp" };
  return null;
}
/* One request is bounded, the session is not, which is how every other
   route here behaves: a publish takes 10MB and a session may hold any
   number of rounds. A reviewer attaching screenshots should never meet
   a ceiling mid-review. */
const uploadBytes = 10 * 1024 * 1024;
async function readBytes(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireValue(size <= limit, "Image is over 10MB", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req, limit) {
  requireValue(
    req.headers["content-type"] === "application/json",
    "JSON required",
    415,
  );
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    requireValue(Buffer.byteLength(raw) <= limit, "Request too large", 413);
  }
  return JSON.parse(raw);
}

// The nearest ancestor process that an adapter recognizes decides which
// session start belongs to, because an agent CLI started inside another
// inherits the outer one's variables. Names are the executables.
function ancestors(pid = process.ppid) {
  const chain = [];
  for (let current = pid; current > 1;) {
    let line;
    try {
      line = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(current)], {
        encoding: "utf8",
      }).trim();
    } catch {
      break;
    }
    const match = /^(\d+)\s+(.*)$/.exec(line);
    if (!match) break;
    chain.push({ pid: current, command: path.basename(match[2].trim()) });
    current = Number(match[1]);
  }
  return chain;
}
export function detectWake(env = process.env, tools = { ancestors }) {
  for (const ancestor of [...tools.ancestors(), null])
    for (const adapter of Object.values(adapters)) {
      const target = adapter.detect(env, { ...tools, ancestor });
      if (target) return target;
    }
  requireValue(
    false,
    "no wake path. This needs Claude Code, Codex, or Copilot, and none of their session variables is set.",
  );
}
function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve();
    });
  });
}
export function wakeRunner(target, line) {
  return adapters[target.harness].wake(target, line, run);
}

export async function startHub(config = settings()) {
  await fs.mkdir(config.hubDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(config.sessions, { recursive: true, mode: 0o700 });
  const secret = crypto.randomBytes(32).toString("hex");
  const startedAt = timestamp();
  const registry = new Map();
  const byDirectory = new Map();
  const register = serializer();
  let origin = null,
    hostOrigin = null,
    allowedHosts = new Set();
  const log = (message) =>
    (config.log || console.log)(`${timestamp()} ${message}`);
  async function adopt(directory) {
    let session = byDirectory.get(directory);
    if (!session) {
      session = await loadSession(directory, config, origin);
      registry.set(session.id, session);
      byDirectory.set(directory, session);
    }
    return session;
  }
  const open = () =>
    [...registry.values()].filter(
      (session) => session.state.stage !== "complete",
    );
  const active = () => open().filter((session) => session.active());
  const listed = () =>
    open()
      .map((session) => session.listing())
      .filter(Boolean)
      .sort(
        (a, b) =>
          Number(b.needsYou) - Number(a.needsYou) ||
          (a.needsYou
            ? Date.parse(a.publishedAt) - Date.parse(b.publishedAt)
            : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
      );
  const roundPage = async (session, entry, flags = {}) => {
    requireValue(entry, "Unknown round", 404);
    const html = await fs.readFile(entry.path, "utf8");
    return embedConfig(html, {
      sessionId: session.id,
      base: session.base,
      ...flags,
    });
  };
  async function handle(req, res) {
    const reply = (code, value, type = "application/json", headers = {}) => {
      res.writeHead(code, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers,
      });
      res.end(
        typeof value === "string" || Buffer.isBuffer(value)
          ? value
          : json(value),
      );
    };
    const html = (value, headers) =>
      reply(200, value, "text/html; charset=utf-8", headers);
    try {
      requireValue(allowedHosts.has(req.headers.host), "Invalid Host", 403);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.split("/").slice(1);
      const method = req.method;
      if (method === "GET" && url.pathname === "/api/hub")
        return reply(200, {
          app: "pair",
          hub: true,
          version,
          pid: process.pid,
          port: origin && Number(new URL(origin).port),
          startedAt,
          live: active().length,
        });
      if (method === "GET" && url.pathname === "/api/sessions")
        return reply(200, { sessions: listed() });
      if (method === "GET" && url.pathname === "/") {
        const sessions = listed();
        const cookie = req.headers.cookie
          ?.split("; ")
          .find((item) => item.startsWith("pair-last="))
          ?.slice("pair-last=".length);
        const remembered = cookie && registry.get(cookie);
        const target =
          sessions.find((item) => item.needsYou)?.url ||
          (remembered?.state.current ? remembered.base + "/" : null) ||
          sessions[0]?.url;
        if (target) return reply(302, "", "text/plain", { Location: target });
        return html(
          '<!doctype html><title>pair</title><p style="font: 14px system-ui; margin: 40px">No live sessions.</p>',
        );
      }
      if (method === "POST" && url.pathname === "/agent/register") {
        requireValue(
          req.headers.authorization === `Bearer ${secret}`,
          "Hub secret required",
          403,
        );
        const data = await readBody(req, 10_000);
        requireValue(
          typeof data.sessionDir === "string" &&
            path.isAbsolute(data.sessionDir),
          "sessionDir must be an absolute path",
        );
        requireValue(
          data.wake &&
            typeof data.wake === "object" &&
            Object.hasOwn(adapters, data.wake.harness),
          `wake must name a harness: ${Object.keys(adapters).join(", ")}`,
        );
        const directory = path.resolve(data.sessionDir);
        const session = await register(() => adopt(directory));
        const next = await session.exclusive(() =>
          session.hold(data.wake, data.start === true),
        );
        await atomic(path.join(directory, "connection.json"), {
          sessionId: session.id,
          origin,
          token: session.token,
          wake: { harness: data.wake.harness },
        });
        return reply(200, {
          sessionId: session.id,
          sessionDir: directory,
          url: origin + session.base + "/",
          wake: { harness: data.wake.harness },
          ...(hostOrigin ? { hostUrl: hostOrigin + session.base + "/" } : {}),
          ...(next ? { next } : {}),
        });
      }
      if (parts[0] === "agent" && parts.length === 3) {
        const session = registry.get(parts[1]);
        requireValue(session, "Unknown session", 404);
        requireValue(
          req.headers.authorization === `Bearer ${session.token}`,
          "Agent token required",
          403,
        );
        if (method === "GET" && parts[2] === "next")
          return reply(
            200,
            await session.exclusive(async () => ({
              status: session.view(),
              event: (await session.pending())[0] || null,
            })),
          );
        if (method === "POST" && parts[2] === "action") {
          const data = await readBody(req, 10_000_000);
          return reply(200, await session.exclusive(() => session.act(data)));
        }
      }
      if (parts[0] === "s" && parts[1]) {
        const session = registry.get(parts[1]);
        requireValue(session, "Unknown session", 404);
        const rest = parts.slice(2);
        const round = () => decodeURIComponent(rest[1]);
        if (method === "GET" && parts.length === 2)
          return reply(302, "", "text/plain", {
            Location: session.base + "/",
          });
        if (method === "GET" && rest.length === 1 && rest[0] === "") {
          if (!session.state.current)
            return reply(200, "No round published yet.", "text/plain");
          // Resolved under the session's directory, so a moved session
          // still serves its current round. A session the reviewer closed
          // is read-only, so no tab left open on it can submit and wake an
          // agent that will never run again.
          return html(
            await roundPage(
              session,
              session.roundEntry(session.state.current.round) ||
                session.state.current,
              session.state.dismissedAt ? { closed: true } : {},
            ),
            {
              "Set-Cookie": `pair-last=${session.id}; Path=/; SameSite=Strict; Max-Age=2592000`,
            },
          );
        }
        if (method === "GET" && rest[0] === "r" && rest.length === 2)
          return html(
            await roundPage(session, session.roundEntry(round()), {
              readonly: true,
            }),
          );
        if (method === "GET" && rest[0] === "preview" && rest.length === 2)
          return html(
            await roundPage(session, session.roundEntry(round()), {
              preview: true,
            }),
          );
        if (
          method === "GET" &&
          rest[0] === "r" &&
          rest[2] === "prototype" &&
          rest.length === 4
        ) {
          const prototype = await session.prototype(
            round(),
            decodeURIComponent(rest[3]),
          );
          return html(prototype.html, {
            "Content-Security-Policy":
              "sandbox allow-scripts allow-forms allow-popups",
          });
        }
        if (method === "GET" && rest[0] === "api" && rest[1] === "status")
          return reply(200, session.view());
        if (method === "GET" && rest[0] === "api" && rest[1] === "page-set")
          return reply(200, session.pageSet(url.searchParams.get("round")));
        if (method === "GET" && rest[0] === "api" && rest[1] === "page")
          return reply(
            200,
            await session.pageRecord(
              url.searchParams.get("round"),
              url.searchParams.get("id"),
              url.searchParams.get("version"),
            ),
          );
        if (method === "GET" && rest[0] === "api" && rest[1] === "submission")
          return reply(200, {
            submission: await session.latestFeedback(
              url.searchParams.get("round"),
            ),
          });
        if (method === "POST" && rest[0] === "api" && rest[1] === "dismiss") {
          requireValue(
            req.headers.origin === `http://${req.headers.host}`,
            "Unauthorized source",
            403,
          );
          return reply(200, await session.exclusive(() => session.dismiss()));
        }
        /* The hub is a local review tool. It binds 127.0.0.1 unless the
           operator sets PAIR_HUB_HOST, and browser routes carry no
           token by design (see session.md), so the same-origin check is what
           stands between a page in another tab and this session. This route
           writes bytes, so it also caps the size and the count, decides the
           type from the leading bytes rather than a header, and names the
           file itself. */
        if (method === "POST" && rest[0] === "api" && rest[1] === "upload") {
          requireValue(
            req.headers.origin === `http://${req.headers.host}`,
            "Unauthorized source",
            403,
          );
          const bytes = await readBytes(req, uploadBytes);
          return reply(
            201,
            await session.exclusive(() => session.upload(bytes)),
          );
        }
        if (
          method === "POST" &&
          rest[0] === "api" &&
          rest[1] === "drawing-scene" &&
          rest.length === 2
        ) {
          requireValue(
            req.headers.origin === `http://${req.headers.host}`,
            "Unauthorized source",
            403,
          );
          const bytes = await readBytes(req, uploadBytes);
          return reply(
            201,
            await session.exclusive(() => session.uploadScene(bytes)),
          );
        }
        if (
          method === "GET" &&
          rest[0] === "api" &&
          rest[1] === "drawing-scene" &&
          rest.length === 3
        ) {
          const scene = await session.readScene(rest[2]);
          return reply(200, scene.bytes, "application/vnd.excalidraw+json");
        }
        /* The thumbnail in the note dialog, and the same image again after a
           reload: the draft keeps a reference and the bytes stay here. */
        if (
          method === "GET" &&
          rest[0] === "api" &&
          rest[1] === "upload" &&
          rest.length === 3
        ) {
          const image = await session.readUpload(rest[2]);
          return reply(200, image.bytes, image.type);
        }
        if (
          method === "DELETE" &&
          rest[0] === "api" &&
          rest[1] === "upload" &&
          rest.length === 3
        ) {
          requireValue(
            req.headers.origin === `http://${req.headers.host}`,
            "Unauthorized source",
            403,
          );
          return reply(
            200,
            await session.exclusive(() => session.removeUpload(rest[2])),
          );
        }
        if (method === "POST" && rest[0] === "api" && rest[1] === "feedback") {
          requireValue(
            req.headers.origin === `http://${req.headers.host}`,
            "Unauthorized source",
            403,
          );
          const data = await readBody(req, 250_000);
          return reply(
            200,
            await session.exclusive(() => session.submit(data)),
          );
        }
      }
      requireValue(false, "Not found", 404);
    } catch (error) {
      reply(
        error.statusCode ||
          (error.code === "ENOENT"
            ? 404
            : error instanceof SyntaxError
              ? 400
              : 500),
        { error: error.message },
      );
    }
  }
  const listen = (host, port) =>
    new Promise((resolve, reject) => {
      const server = http.createServer(handle);
      server.once("error", reject);
      server.listen(port, host, () => resolve(server));
    });
  const servers = [await listen("127.0.0.1", config.port)];
  const port = servers[0].address().port;
  origin = `http://127.0.0.1:${port}`;
  const hosts = ["127.0.0.1"];
  if (config.host) {
    try {
      servers.push(await listen(config.host, port));
    } catch (error) {
      servers[0].close();
      throw error;
    }
    hosts.push(config.host);
    hostOrigin = `http://${config.host}:${port}`;
  }
  allowedHosts = new Set(
    [...hosts, "localhost"].map((host) => `${host}:${port}`),
  );
  for (const name of await fs.readdir(config.sessions)) {
    const directory = path.join(config.sessions, name);
    if (!(await exists(path.join(directory, "status.json")))) continue;
    try {
      await adopt(directory);
    } catch (error) {
      log(`skipped session ${name}: ${error.message}`);
    }
  }
  await atomic(config.hubFile, {
    pid: process.pid,
    port,
    hosts,
    version,
    startedAt,
    secret,
  });
  let lastLiveAt = Date.now();
  let closing = false;
  let timer;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      if ((await read(config.hubFile)).pid === process.pid)
        await fs.rm(config.hubFile, { force: true });
    } catch {
      /* The record is already gone or belongs to a newer hub. */
    }
  };
  timer = setInterval(
    async () => {
      const now = Date.now();
      if (active().length) lastLiveAt = now;
      else if (now - lastLiveAt > config.idleMs) {
        log("no live sessions; exiting");
        await close();
        process.exit(0);
      }
    },
    Math.min(5000, Math.max(50, config.idleMs / 4)),
  );
  log(
    `hub ${version} listening on ${origin}${hostOrigin ? ` and ${hostOrigin}` : ""}`,
  );
  return { origin, hostOrigin, port, secret, close };
}

export async function readRecord(config) {
  try {
    return await read(config.hubFile);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
// The interactive-plan hub answers /api/hub on the same port with the same
// fields, so only a reply naming pair is pair's hub. A pair hub whose code
// predates that field is known instead by the pid in pair's own record.
export async function hubInfo(port, record) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hub`, {
      signal: AbortSignal.timeout(1500),
    });
    const info = await response.json();
    return info.app === "pair" || (record && info.pid === record.pid)
      ? info
      : null;
  } catch {
    return null;
  }
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
async function waitFor(check, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(150);
  }
  return null;
}
// A hub answers on its port as soon as it listens, but writes its record
// only after it has loaded every session on disk, and it cannot register a
// session before then. So a hub counts as started once its record names it.
async function recordedHub(config) {
  const record = await readRecord(config);
  if (!record) return null;
  const info = await hubInfo(record.port, record);
  return info?.pid === record.pid ? info : null;
}
async function spawnHub(config) {
  await fs.mkdir(config.hubDir, { recursive: true, mode: 0o700 });
  const log = await fs.open(config.hubLog, "a", 0o600);
  const child = spawn(process.execPath, [cli, "hub"], {
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    cwd: os.homedir(),
  });
  child.unref();
  await log.close();
  // When another start spawned a hub at the same moment, the one that took
  // the port is the one the record names.
  const started = await waitFor(() => recordedHub(config), 15_000);
  requireValue(
    started,
    process.env.CODEX_SANDBOX
      ? `The hub did not start inside the sandbox (its log is ${config.hubLog}): ${sandboxAdvice()}`
      : `The hub did not start; see ${config.hubLog}`,
  );
  return started;
}
export async function ensureHub(config = settings()) {
  const record = await readRecord(config);
  const port = record?.port || config.port;
  let info = port ? await hubInfo(port, record) : null;
  if (!info && record && processAlive(record.pid))
    info = await waitFor(() => hubInfo(record.port, record), 5000);
  // A hub that answers with no record may still be loading its sessions.
  if (info && !record) info = await waitFor(() => recordedHub(config), 15_000);
  if (info && info.version !== version) {
    if (info.live === 0) {
      process.kill(info.pid, "SIGTERM");
      await waitFor(async () => !(await hubInfo(info.port, record)), 5000);
      info = null;
    } else
      console.error(
        `pair: the hub runs code version ${info.version}; this command is ${version}. It restarts when no session is live.`,
      );
  }
  if (!info) {
    if (record) await fs.rm(config.hubFile, { force: true });
    requireValue(
      !(config.port && (await portOpen(config.port))),
      `Port ${config.port} is in use by another program; set PAIR_HUB_PORT`,
    );
    info = await spawnHub(config);
  }
  return { ...info, origin: `http://127.0.0.1:${info.port}` };
}
export async function attach(directory, config, wake, start = false) {
  const hub = await ensureHub(config);
  const record = await readRecord(config);
  requireValue(
    record && record.pid === hub.pid,
    "The hub record is missing; stop the hub process and run `pair start` again",
  );
  const response = await fetch(hub.origin + "/agent/register", {
    method: "POST",
    headers: {
      authorization: `Bearer ${record.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionDir: directory, wake, start }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  requireValue(response.ok, result.error || "Registration failed");
  return result;
}

// The source a round was built from is kept beside its built file, so the
// next round starts from it after the temp directory is gone.
async function keepSource(sessionDir, source, html) {
  const record = pageData(html);
  const target = path.join(
    path.resolve(sessionDir),
    "src",
    record.round,
    record.page.id,
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.mkdir(target);
  } catch (error) {
    requireValue(
      error.code !== "EEXIST",
      `Source for round ${record.round} already exists at ${target}`,
    );
    throw error;
  }
  await fs.cp(path.resolve(source), target, { recursive: true });
  return target;
}
// Codex sets CODEX_SANDBOX for every command, bypassed or not, so only a
// real refusal from the sandbox earns the advice.
const sandboxAdvice = () =>
  "run this command outside the sandbox (escalated), and run `pair check --codex-rules` once so an allow rule keeps Codex from asking again";
export function withSandboxHint(message, env = process.env) {
  if (!env.CODEX_SANDBOX || !/\bEPERM\b/.test(message)) return message;
  return `${message}. The sandbox blocked it: ${sandboxAdvice()}`;
}
function argumentsFrom(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    requireValue(rest[i].startsWith("--"), "Options must use --name value");
    const key = rest[i].slice(2);
    requireValue(
      rest[i + 1] && !rest[i + 1].startsWith("--"),
      `Missing value for --${key}`,
    );
    options[key] = rest[++i];
  }
  return { command, options };
}
export async function main(argv) {
  requireValue(
    Number(process.versions.node.split(".")[0]) >= 20,
    "Node 20 or newer is required",
  );
  const { command, options } = argumentsFrom(argv);
  const config = settings();
  if (command === "hub") {
    const hub = await startHub(config);
    for (const signal of ["SIGTERM", "SIGINT"])
      process.once(signal, () => hub.close().then(() => process.exit(0)));
    return;
  }
  let directory =
    options["session-dir"] && path.resolve(options["session-dir"]);
  const wake = detectWake();
  if (command === "start") {
    const resuming = Boolean(directory);
    directory ||= path.join(config.sessions, crypto.randomUUID());
    const started = await attach(directory, config, wake, true);
    return console.log(
      json({
        ...started,
        next:
          started.next ||
          (resuming
            ? `Run: pair ack --session-dir ${directory}`
            : `When the first round is ready, publish it as ${await guideFile("round.md", config.root)} describes, from "Publish the round".`),
      }),
    );
  }
  requireValue(directory, "Every operation requires --session-dir PATH");
  const connectionFile = path.join(directory, "connection.json");
  if (!(await exists(connectionFile))) await attach(directory, config, wake);
  let connection = await read(connectionFile);
  const checkConnection = () =>
    requireValue(
      /^http:\/\/127\.0\.0\.1:\d+$/.test(connection.origin),
      "Invalid connection origin",
    );
  checkConnection();
  // Every command names the agent that runs it, and the hub takes commands
  // only from the session's holder.
  const agent = identify(wake);
  async function request(data, retry = true) {
    const reattach = async () => {
      await attach(directory, config, wake);
      connection = await read(connectionFile);
      checkConnection();
      return request(data, false);
    };
    let response;
    try {
      response = await fetch(
        `${connection.origin}/agent/${connection.sessionId}/action`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${connection.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...data,
            sessionId: connection.sessionId,
            agent,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch (error) {
      if (retry && error.name === "TypeError") return reattach();
      throw error;
    }
    const result = await response.json();
    if (retry && response.status === 404 && result.error === "Unknown session")
      return reattach();
    requireValue(
      response.ok,
      result.error || "Request failed",
      response.status,
    );
    requireValue(
      (result.status?.sessionId || result.sessionId) === connection.sessionId,
      "Helper identity changed; resume the intended session",
      409,
    );
    return result;
  }
  const action = { action: command };
  if (command === "status")
    return console.log(json((await request(action)).status));
  if (command === "read") action.id = options.id;
  if (command === "ack") action.note = options.note;
  if (command === "pause") action.reason = options.reason;
  if (command === "progress") {
    requireValue(
      options.start && !options.pages && !options.steps && !options.done,
      "progress takes --start ID",
    );
    action.start = options.start.split("|");
  }
  let kept = null;
  if (command === "publish") {
    requireValue(options.file, "publish requires --file HTML");
    action.html = await fs.readFile(path.resolve(options.file), "utf8");
    if (options.pages)
      action.pages = (await read(path.resolve(options.pages))).pages;
    if (options.source) {
      kept = await keepSource(
        options["session-dir"],
        options.source,
        action.html,
      );
      action.source = kept;
    }
  }
  try {
    console.log(json(await request(action)));
  } catch (error) {
    if (kept) await fs.rm(kept, { recursive: true, force: true });
    throw error;
  }
}
