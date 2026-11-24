import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { assembleHome } from "../build/assemble.mjs";
import { isClosed } from "../shared/lifecycle.mjs";
import {
  agentRequestBytes,
  packageRoot,
  settings,
  version,
} from "../shared/settings.mjs";
import {
  atomic,
  embedConfig,
  exists,
  json,
  listen,
  read,
  requireValue,
  serializer,
  timestamp,
} from "../shared/util.mjs";
import { firstAnswers, firstAnswersHead } from "./first-answers.mjs";
import { startFrom, withClosedParents } from "./linking.mjs";
import { DEFAULT_LIMIT, KINDS, searchStore } from "./search/store.mjs";
import { seenStore } from "./seen.mjs";
import { loadSession } from "./session/state.mjs";
import { readBytes, uploadBytes } from "./session/uploads.mjs";
import { adapters } from "./wake.mjs";

async function readBody(req, limit) {
  requireValue(
    req.headers["content-type"] === "application/json",
    "JSON required",
    415,
  );
  // A chunk can end inside a UTF-8 character, so readBody decodes the body
  // only after every chunk arrives.
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireValue(
      size <= limit,
      `The request is over the hub's limit of ${limit} bytes.`,
      413,
    );
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
// A session directory can be reached by more than one path, such as
// /tmp/… and /private/tmp/… on macOS. The hub keys a session by the real
// path of its parent and its own name, because a new session's directory
// does not exist yet when pair start registers it.
const canonical = async (directory) =>
  path.join(
    await fs
      .realpath(path.dirname(directory))
      .catch(() => path.dirname(directory)),
    path.basename(directory),
  );

/* Browser routes take no token, as docs/reference/commands.md says under
   PAIR_HUB_HOST. sameOrigin is the only check that stops a page in another
   tab from posting to a session or to the seen lists. */
const sameOrigin = (req) =>
  requireValue(
    req.headers.origin === `http://${req.headers.host}`,
    "Unauthorized source",
    403,
  );

const COMPRESS_OVER_BYTES = 1024;

const serializeReply = (value) =>
  typeof value === "string" || Buffer.isBuffer(value) ? value : json(value);

const isCompressibleType = (type) =>
  type === "application/json" || type.startsWith("text/html");

const shouldCompress = ({ text, type, req, localHosts }) =>
  typeof text === "string" &&
  isCompressibleType(type) &&
  !localHosts.has(req.headers.host) &&
  Buffer.byteLength(text) > COMPRESS_OVER_BYTES &&
  /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");

function embedFlags(state, round) {
  if (isClosed(state)) return { closed: true };
  return round === state.current?.round ? {} : { readonly: true };
}

function errorStatusCode(error) {
  if (error.statusCode) return error.statusCode;
  if (error.code === "ENOENT") return 404;
  if (error instanceof SyntaxError || error instanceof URIError) return 400;
  return 500;
}

function validateRegisterData(data) {
  requireValue(
    typeof data.sessionDir === "string" && path.isAbsolute(data.sessionDir),
    "sessionDir must be an absolute path",
  );
  requireValue(
    data.wake &&
      typeof data.wake === "object" &&
      Object.hasOwn(adapters, data.wake.harness),
    `wake must name a harness: ${Object.keys(adapters).join(", ")}`,
  );
  requireValue(
    data.folder === undefined ||
      (typeof data.folder === "string" && path.isAbsolute(data.folder)),
    "folder must be an absolute path",
  );
}

function parseSearchParams(params) {
  const limit = Number(params.get("limit") || DEFAULT_LIMIT);
  requireValue(
    Number.isInteger(limit) && limit > 0 && limit <= 500,
    "Invalid limit",
  );
  const kinds = (params.get("kinds") || "").split(",").filter(Boolean);
  requireValue(
    kinds.every((kind) => KINDS.includes(kind)),
    "Invalid kinds",
  );
  return {
    query: params.get("q") || "",
    session: params.get("session"),
    round: params.get("round"),
    closed: params.get("closed") === "1",
    here: params.get("here"),
    kinds,
    limit,
  };
}

function closedRoundLocation(session, url) {
  const wanted = url.searchParams.get("round");
  if (!wanted || wanted === session.state.current.round) return null;
  const params = new URLSearchParams(url.searchParams);
  params.delete("round");
  const query = params.size ? `?${params}` : "";
  return `${session.base}/r/${encodeURIComponent(wanted)}${query}`;
}

async function handleProposalAction({ req, session, rest, reply }) {
  // Only start and open-agent have a body. The body of start contains
  // where the work runs, and both bodies can contain the reviewer's
  // message.
  const cardActions = {
    start: session.startProposal,
    decline: session.declineProposal,
    restore: session.restoreProposal,
    "open-agent": session.openAgent,
  };
  if (!Object.hasOwn(cardActions, rest[3])) return false;
  const data = ["start", "open-agent"].includes(rest[3])
    ? await readBody(req, 50_000)
    : null;
  const id = decodeURIComponent(rest[2]);
  reply(200, await session.exclusive(() => cardActions[rest[3]](id, data)));
  return true;
}

async function handleThreadAction({ req, session, rest, reply }) {
  const threadActions = {
    messages: [201, session.addThreadMessage],
    acknowledge: [200, session.acknowledge],
  };
  if (!Object.hasOwn(threadActions, rest[3])) return false;
  const data = await readBody(req, 250_000);
  const [code, act] = threadActions[rest[3]];
  reply(
    code,
    await session.exclusive(() => act(decodeURIComponent(rest[2]), data)),
  );
  return true;
}

function lookupRoute(routes, exactKey, prefixKey) {
  if (Object.hasOwn(routes, exactKey)) return routes[exactKey];
  if (Object.hasOwn(routes, prefixKey)) return routes[prefixKey];
  return null;
}

export async function startHub(config = settings()) {
  await fs.mkdir(config.hubDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(config.sessions, { recursive: true, mode: 0o700 });
  const secret = crypto.randomBytes(32).toString("hex");
  const startedAt = timestamp();
  // The /api/hub response contains the real path of the state directory, so
  // a command with no hub record can tell a hub that is still loading from a
  // hub of another state directory.
  const stateDir = await fs.realpath(config.root);
  const registry = new Map();
  const byDirectory = new Map();
  const register = serializer();
  // inFlight counts the requests the hub has not finished answering, and
  // shutDown() sets drained to learn when the count reaches 0.
  let inFlight = 0;
  let drained = null;
  let origin = null,
    hostOrigin = null,
    allowedHosts = new Set(),
    localHosts = new Set();
  // Every pair tab gets the session list in the page the hub serves and then
  // polls it every 5 seconds, and no pair command requests it. The last
  // session list the hub sent to this machine therefore marks the last poll
  // of any pair tab on it. sessionList ignores a request to the PAIR_HUB_HOST
  // address, such as a phone's, because the agent opens its tab on this
  // machine. A new hub treats no tab as open until a tab polls it.
  let tabPolledAt = -Infinity;
  const tabOpen = () => Date.now() - tabPolledAt < config.tabWindowMs;
  const log = (message) =>
    (config.log || console.log)(`${timestamp()} ${message}`);
  const search = searchStore({ log });
  async function adopt(directory) {
    const known = await canonical(directory);
    let session = byDirectory.get(known);
    if (!session) {
      session = await loadSession(directory, config, {
        origin,
        tabOpen,
        peer: (id) => registry.get(id),
        changed: search.markChanged,
        markSeen: (keys) => seen.addToStarted(keys, listed()),
      });
      registry.set(session.id, session);
      byDirectory.set(known, session);
      void search.add(session.id, session.directory);
    }
    return session;
  }
  const open = () =>
    [...registry.values()].filter((session) => !isClosed(session.state));
  const active = () => open().filter((session) => session.active());
  const listed = () =>
    withClosedParents(open(), (id) => registry.get(id))
      .map((session) => session.listing())
      .toSorted(
        (a, b) =>
          Number(b.needsYou) - Number(a.needsYou) ||
          (a.needsYou
            ? Date.parse(a.publishedAt) - Date.parse(b.publishedAt)
            : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
      );
  const seen = await seenStore(config.seenFile, log);
  // GET /api/sessions returns the seen lists with the sessions, so the
  // frame's existing poll fetches both.
  const sessionList = async (req) => {
    if (localHosts.has(req.headers.host)) tabPolledAt = Date.now();
    const sessions = listed();
    const lists = await seen.view(sessions);
    const cleared = new Set(lists.cleared ?? []);
    return {
      sessions: sessions.map((entry) =>
        Object.assign({}, entry, {
          events: registry.get(entry.id).withWords(entry.events, cleared),
        }),
      ),
      seen: lists,
    };
  };
  // Chrome can paint a page before it parses all of it, so a session the
  // reviewer switched to showed an empty sidebar and reading column before
  // the frame drew into them. A module script in the head with
  // blocking="render" keeps the previous page on screen until the browser runs
  // it, and the browser runs module scripts in document order after it parses
  // the page. framePage puts the script last in the head, after the frame's
  // and the page's modules, so the first paint comes after they have run. The
  // browser never runs a script with no text, so the script contains a comment.
  const renderGate = `<script type="module" blocking="render">/* render gate */</script>`;
  const framePage = (session, html, { flags = {}, head = "" } = {}) =>
    embedConfig(
      html.replace("</head>", () => head + renderGate + "</head>"),
      {
        sessionId: session.id,
        base: session.base,
        hubVersion: version,
        ...(session.state.parent ? { parent: session.parentView() } : {}),
        ...flags,
      },
    );
  const roundPage = async (session, entry, { flags = {}, head = "" } = {}) => {
    requireValue(entry, "Unknown round", 404);
    const readOnly = Boolean(flags.readonly || flags.closed);
    const html =
      (await session.renderRound(entry.round, { readOnly })) ??
      (await fs.readFile(entry.path, "utf8"));
    return framePage(session, html, { flags, head });
  };
  /* The search window loads a session's frame when a result needs it, on a
     phone as well, so the frame is compressed, and a compressed one is kept
     until its round changes. */
  const EMBEDS_KEPT = 8;
  const embeds = new Map();
  async function embedPage(session, round) {
    const flags = embedFlags(session.state, round);
    const key = [
      session.id,
      round,
      session.pageSet(round).generation,
      Object.keys(flags),
      session.state.parent?.sessionId,
    ].join("|");
    if (!embeds.has(key)) {
      const page = framePage(session, await session.renderForPreview(round), {
        flags: { embedded: true, ...flags },
      });
      embeds.set(key, gzipSync(page));
      if (embeds.size > EMBEDS_KEPT) embeds.delete(embeds.keys().next().value);
    }
    return embeds.get(key);
  }
  function rememberedTarget(req) {
    const cookie = req.headers.cookie
      ?.split("; ")
      .find((item) => item.startsWith("pair-last="))
      ?.slice("pair-last=".length);
    const remembered = cookie && registry.get(cookie);
    const last = remembered?.state.current ? remembered.base + "/" : null;
    return {
      active: remembered && !isClosed(remembered.state) ? last : null,
      last,
    };
  }
  function handleRootRedirect({ req, reply, html }) {
    const sessions = listed();
    const { active: rememberedActive, last } = rememberedTarget(req);
    // A closed session the reviewer viewed last is the target only when no
    // session is open.
    const target =
      sessions.find((item) => item.needsYou)?.url ||
      rememberedActive ||
      sessions.find((item) => !item.closed)?.url ||
      last;
    if (target) {
      return reply(302, "", {
        type: "text/plain",
        headers: { Location: target },
      });
    }
    return html(
      '<!doctype html><title>pair</title><p style="font: 14px system-ui; margin: 40px">No live sessions.</p>',
    );
  }
  async function handleAgentRegister({ req, reply }) {
    requireValue(
      req.headers.authorization === `Bearer ${secret}`,
      "Hub secret required",
      403,
    );
    const data = await readBody(req, 10_000);
    validateRegisterData(data);
    const requested = path.resolve(data.sessionDir);
    const { session, created, card, joined } = await register(async () => {
      const isNew = !(await exists(path.join(requested, "status.json")));
      if (data.from === undefined) {
        return { created: isNew, session: await adopt(requested) };
      }
      return {
        created: isNew,
        ...(await startFrom(adopt, {
          directory: requested,
          created: isNew,
          data,
        })),
      };
    });
    const { directory } = session;
    const answer = await session.exclusive(() =>
      session.hold(data.wake, {
        ...data,
        created,
        ...(card ? { title: card.title } : {}),
      }),
    );
    // hold leaves state.wake as it is when an agent other than the
    // holder registers, so the hub writes the holder's harness here.
    const wake = { harness: session.state.wake.harness };
    await atomic(path.join(directory, "connection.json"), {
      sessionId: session.id,
      origin,
      token: session.token,
      wake,
    });
    return reply(200, {
      sessionId: session.id,
      sessionDir: directory,
      url: origin + session.base + "/",
      wake,
      ...(hostOrigin ? { hostUrl: hostOrigin + session.base + "/" } : {}),
      ...(session.state.title ? { title: session.state.title } : {}),
      ...(card ? { parent: session.state.parent, proposal: card, joined } : {}),
      ...answer,
    });
  }
  const globalRoutes = {
    "GET /api/search": async ({ url, reply }) =>
      reply(200, await search.search(parseSearchParams(url.searchParams))),
    "GET /api/search/sessions": async ({ reply }) =>
      reply(200, { sessions: await search.sessionChoices() }),
    "GET /api/hub": ({ reply }) =>
      reply(200, {
        app: "pair",
        hub: true,
        version,
        pid: process.pid,
        port: origin && Number(new URL(origin).port),
        startedAt,
        stateDir,
        root: packageRoot,
        live: active().length,
      }),
    "GET /api/sessions": async ({ req, polled }) =>
      polled(await sessionList(req)),
    "GET /api/notifications": ({ reply }) =>
      reply(200, {
        sessions: Object.fromEntries(
          open().map((session) => [session.id, session.notificationView()]),
        ),
      }),
    "POST /api/seen": async ({ req, reply }) => {
      sameOrigin(req);
      const data = await readBody(req, 250_000);
      return reply(200, await seen.add(data, listed()));
    },
    "GET /": handleRootRedirect,
    "POST /agent/register": handleAgentRegister,
  };
  async function handleAgentAction({ req, parts, reply }) {
    const session = registry.get(parts[1]);
    requireValue(session, "Unknown session", 404);
    requireValue(
      req.headers.authorization === `Bearer ${session.token}`,
      "Agent token required",
      403,
    );
    if (req.method !== "POST" || parts[2] !== "action") return false;
    const data = await readBody(req, agentRequestBytes);
    reply(200, await session.exclusive(() => session.act(data)));
    return true;
  }
  async function handleSessionIndex({ req, url, session, reply, html }) {
    // The hub serves a session the reviewer closed as read-only, so a
    // tab left open on it cannot submit and wake an agent that has
    // finished.
    const closed = isClosed(session.state);
    const flags = closed ? { closed: true } : {};
    const head = closed
      ? ""
      : firstAnswersHead(await firstAnswers(session, await sessionList(req)));
    if (!session.state.current) {
      return html(
        framePage(session, await assembleHome(session.listing().title), {
          flags: { home: true, ...flags },
          head,
        }),
      );
    }
    // A closed session's frame shows one round, so an older round opens at
    // its own address.
    const redirect = closed ? closedRoundLocation(session, url) : null;
    if (redirect) {
      return reply(302, "", {
        type: "text/plain",
        headers: { Location: redirect },
      });
    }
    const entry = session.roundEntry(session.state.current.round);
    return html(await roundPage(session, entry, { flags, head }), {
      "Set-Cookie": `pair-last=${session.id}; Path=/; SameSite=Strict; Max-Age=2592000`,
    });
  }
  const sessionPageRoutes = {
    ":1": handleSessionIndex,
    "r:2": async ({ session, round, html }) =>
      html(
        await roundPage(session, session.roundEntry(round()), {
          flags: {
            readonly: true,
            ...(isClosed(session.state) ? { closed: true } : {}),
          },
        }),
      ),
    "embed:2": async ({ session, round, reply }) => {
      const wanted =
        round() === "latest" ? session.state.current?.round : round();
      return reply(200, await embedPage(session, wanted), {
        type: "text/html; charset=utf-8",
        headers: { "Content-Encoding": "gzip" },
      });
    },
    "preview:2": async ({ session, round, html }) =>
      html(
        await roundPage(session, session.roundEntry(round()), {
          flags: { preview: true },
        }),
      ),
    "r:4": async ({ session, rest, round, html }) => {
      if (rest[2] !== "prototype") return false;
      const prototype = await session.prototype(
        round(),
        decodeURIComponent(rest[3]),
      );
      html(prototype.html, {
        "Content-Security-Policy":
          "sandbox allow-scripts allow-forms allow-popups",
      });
      return true;
    },
  };
  const sessionApiRoutes = {
    "GET status": ({ session, polled }) =>
      polled({ ...session.browserView(), hubVersion: version }),
    // The hub only appends a thread's messages, so an address always names
    // the same image, and the browser keeps it.
    "GET thread-image:5": ({ session, rest, reply }) => {
      const image = session.threadImage(
        decodeURIComponent(rest[2]),
        Number(rest[3]),
        Number(rest[4]),
      );
      reply(200, image.bytes, {
        type: image.type,
        headers: {
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      });
    },
    // The browser sends no Origin header with a same-origin GET, so only
    // the Host check protects this read, as it protects the other reads.
    "GET draft:2": ({ session, reply }) => reply(200, session.draftView()),
    "POST draft:2": async ({ req, session, reply }) => {
      const data = await readBody(req, 250_000);
      reply(200, await session.exclusive(() => session.changeDraft(data)));
    },
    "GET page-set": ({ url, session, reply }) =>
      reply(200, session.pageSet(url.searchParams.get("round"))),
    "GET page": async ({ url, session, reply }) =>
      reply(
        200,
        await session.pageRecord(
          url.searchParams.get("round"),
          url.searchParams.get("id"),
          url.searchParams.get("version"),
        ),
      ),
    "GET submission": async ({ url, session, reply }) =>
      reply(200, {
        submission: await session.latestFeedback(url.searchParams.get("round")),
      }),
    "POST dismiss": async ({ session, reply }) =>
      reply(200, await session.exclusive(() => session.close())),
    "POST proposals:2": async ({ req, session, reply }) => {
      const data = await readBody(req, 50_000);
      reply(200, await session.exclusive(() => session.writeProposal(data)));
    },
    "POST proposals:4": handleProposalAction,
    /* readBytes caps the upload's size, and session.upload takes the
       type from the leading bytes, not a header, and chooses the file
       name itself. */
    "POST upload": async ({ req, session, reply }) => {
      const bytes = await readBytes(req, uploadBytes);
      reply(201, await session.exclusive(() => session.upload(bytes)));
    },
    "POST drawing-scene:2": async ({ req, session, reply }) => {
      const bytes = await readBytes(req, uploadBytes);
      reply(201, await session.exclusive(() => session.uploadScene(bytes)));
    },
    "GET drawing-scene:3": async ({ session, rest, reply }) => {
      const scene = await session.readScene(rest[2]);
      reply(200, scene.bytes, {
        type: "application/vnd.excalidraw+json",
      });
    },
    /* The frame loads each uploaded image from this route by its ID,
       also after a reload, because the frame's draft stores only the ID
       and the hub stores the bytes. */
    "GET upload:3": async ({ session, rest, reply }) => {
      const image = await session.readUpload(rest[2]);
      reply(200, image.bytes, { type: image.type });
    },
    "DELETE upload:3": async ({ session, rest, reply }) =>
      reply(200, await session.exclusive(() => session.removeUpload(rest[2]))),
    "POST threads:2": async ({ req, session, reply }) => {
      const data = await readBody(req, 250_000);
      reply(201, await session.exclusive(() => session.startThread(data)));
    },
    "POST threads:4": handleThreadAction,
    "POST feedback": async ({ req, session, reply }) => {
      const data = await readBody(req, 250_000);
      reply(200, await session.exclusive(() => session.submit(data)));
    },
  };
  async function handleSessionRoute(ctx) {
    const { req, parts, reply } = ctx;
    const session = registry.get(parts[1]);
    requireValue(session, "Unknown session", 404);
    if (req.method !== "GET") sameOrigin(req);
    if (req.method === "GET" && parts.length === 2) {
      reply(302, "", {
        type: "text/plain",
        headers: { Location: session.base + "/" },
      });
      return true;
    }
    const rest = parts.slice(2);
    const sessionCtx = {
      ...ctx,
      session,
      rest,
      round: () => decodeURIComponent(rest[1]),
    };
    if (rest[0] === "api") {
      const handler = lookupRoute(
        sessionApiRoutes,
        `${req.method} ${rest[1]}:${rest.length}`,
        `${req.method} ${rest[1]}`,
      );
      if (!handler) return false;
      return (await handler(sessionCtx)) !== false;
    }
    if (req.method !== "GET") return false;
    const pageKey = `${rest[0]}:${rest.length}`;
    if (!Object.hasOwn(sessionPageRoutes, pageKey)) return false;
    return (await sessionPageRoutes[pageKey](sessionCtx)) !== false;
  }
  function createResponder(req, res) {
    const reply = (
      code,
      value,
      { type = "application/json", headers = {} } = {},
    ) => {
      const text = serializeReply(value);
      // A round's page can reach megabytes, and gzip holds the hub for about
      // 190 ms on a 12 MB page. A browser on this machine would wait that long
      // to save nothing, so only one on another machine, such as a phone, gets
      // a compressed reply. The embed route compresses its own page into a
      // Buffer.
      const large = shouldCompress({ text, type, req, localHosts });
      // A command compares X-Pair-Version with its own code version after its
      // requests, and replaces a hub that runs other code.
      res.writeHead(code, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Pair-Version": version,
        ...(large ? { "Content-Encoding": "gzip" } : {}),
        ...headers,
      });
      res.end(large ? gzipSync(text) : text);
    };
    const html = (value, headers) =>
      reply(200, value, { type: "text/html; charset=utf-8", headers });
    // The frame polls the status and the session list, and sends back the tag
    // of its last answer, so a poll that finds no change costs only headers.
    // The tag is weak because a compressed body differs by the byte.
    const polled = (value) => {
      const text = json(value);
      const hash = crypto.createHash("sha256").update(text).digest("base64url");
      const tag = `W/"${hash}"`;
      if (req.headers["if-none-match"] !== tag) {
        return reply(200, text, { headers: { ETag: tag } });
      }
      res.writeHead(304, { ETag: tag, "Cache-Control": "no-store" });
      res.end();
    };
    return { reply, html, polled };
  }
  async function dispatch(ctx) {
    const { req, url, parts } = ctx;
    const globalKey = `${req.method} ${url.pathname}`;
    if (Object.hasOwn(globalRoutes, globalKey)) {
      await globalRoutes[globalKey](ctx);
      return true;
    }
    if (parts[0] === "agent" && parts.length === 3) {
      return handleAgentAction(ctx);
    }
    if (parts[0] === "s" && parts[1]) {
      return handleSessionRoute(ctx);
    }
    return false;
  }
  async function handle(req, res) {
    inFlight++;
    res.once("close", () => {
      if (--inFlight === 0) drained?.();
    });
    const responder = createResponder(req, res);
    try {
      requireValue(allowedHosts.has(req.headers.host), "Invalid Host", 403);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.split("/").slice(1);
      const handled = await dispatch({ req, url, parts, ...responder });
      requireValue(handled, "Not found", 404);
    } catch (error) {
      responder.reply(errorStatusCode(error), {
        error: error.message,
        ...error.details,
      });
    }
  }
  const servers = [await listen(http.createServer(handle), config.port)];
  const port = servers[0].address().port;
  origin = `http://127.0.0.1:${port}`;
  const hosts = ["127.0.0.1"];
  if (config.host) {
    try {
      servers.push(await listen(http.createServer(handle), port, config.host));
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
  localHosts = new Set(
    ["127.0.0.1", "localhost"].map((host) => `${host}:${port}`),
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
  seen.loaded();
  await atomic(config.hubFile, {
    pid: process.pid,
    port,
    hosts,
    version,
    startedAt,
    secret,
  });
  let lastLiveAt = Date.now();
  let closing = null;
  let settle;
  const closed = new Promise((resolve) => (settle = resolve));
  const close = () => (closing ||= shutDown().then(settle));
  let quietCheckedAt = Date.now();
  const timer = setInterval(
    async () => {
      const now = Date.now();
      if (now - quietCheckedAt >= config.quietCheckMs) {
        quietCheckedAt = now;
        for (const session of active()) {
          session
            .exclusive(() => session.wakeIfQuiet(now))
            .catch((error) =>
              log(`quiet check of session ${session.id}: ${error.message}`),
            );
        }
      }
      if (active().length) lastLiveAt = now;
      else if (now - lastLiveAt > config.idleMs) {
        log("no live sessions; exiting");
        await close();
      }
    },
    Math.max(50, Math.min(5000, config.idleMs / 4, config.quietCheckMs)),
  );
  // The hub stops accepting connections and lets the requests in progress
  // finish, for up to 3 seconds, so a command or a Send in progress when a
  // command replaces the hub gets its answer. Then it closes every connection
  // that remains. A browser keeps connections open that have sent no request,
  // and Node 24's closeIdleConnections() leaves those open, so the hub waits
  // for its requests instead of for its connections.
  async function shutDown() {
    clearInterval(timer);
    const stopped = servers.map(
      (server) => new Promise((resolve) => server.close(resolve)),
    );
    if (inFlight > 0) {
      await new Promise((resolve) => {
        const cutOff = setTimeout(resolve, 3000);
        drained = () => {
          clearTimeout(cutOff);
          resolve();
        };
      });
    }
    for (const server of servers) server.closeAllConnections();
    await Promise.all(stopped);
    await search.close();
    try {
      if ((await read(config.hubFile)).pid === process.pid) {
        await fs.rm(config.hubFile, { force: true });
      }
    } catch {
      /* The hub record is already gone or unreadable. */
    }
  }
  log(
    `hub ${version} listening on ${origin}${hostOrigin ? ` and ${hostOrigin}` : ""}`,
  );
  return { origin, hostOrigin, port, secret, close, closed };
}
