import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { assembleHome } from "../build/assemble.mjs";
import { settings, version } from "../shared/settings.mjs";
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
  async function adopt(directory) {
    const known = await canonical(directory);
    let session = byDirectory.get(known);
    if (!session) {
      session = await loadSession(directory, config, origin, tabOpen, (id) =>
        registry.get(id),
      );
      registry.set(session.id, session);
      byDirectory.set(known, session);
    }
    return session;
  }
  const open = () =>
    [...registry.values()].filter(
      (session) => session.state.stage !== "complete",
    );
  const active = () => open().filter((session) => session.active());
  const listed = () =>
    withClosedParents(open(), (id) => registry.get(id))
      .map((session) => session.listing())
      .sort(
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
    return { sessions, seen: await seen.view(sessions) };
  };
  /* Browser routes take no token, as docs/reference/commands.md says under
     PAIR_HUB_HOST. sameOrigin is the only check that stops a page in another
     tab from posting to a session or to the seen lists. */
  const sameOrigin = (req) =>
    requireValue(
      req.headers.origin === `http://${req.headers.host}`,
      "Unauthorized source",
      403,
    );
  // Chrome can paint a page before it parses all of it, so a session the
  // reviewer switched to showed an empty sidebar and reading column before
  // the frame drew into them. A module script in the head with
  // blocking="render" keeps the previous page on screen until the browser runs
  // it, and the browser runs module scripts in document order after it parses
  // the page. framePage puts the script last in the head, after the frame's
  // and the page's modules, so the first paint comes after they have run. A
  // round built before those modules moved into the head has them at the end
  // of the body, after this script, and Chrome can paint its bare frame first.
  // The browser never runs a script with no text, so the script contains a
  // comment.
  const renderGate = `<script type="module" blocking="render">/* render gate */</script>`;
  const framePage = (session, html, flags, head) =>
    embedConfig(
      html.replace("</head>", () => head + renderGate + "</head>"),
      {
        sessionId: session.id,
        base: session.base,
        ...(session.state.parent ? { parent: session.parentView() } : {}),
        ...flags,
      },
    );
  const roundPage = async (session, entry, flags = {}, head = "") => {
    requireValue(entry, "Unknown round", 404);
    const html = await fs.readFile(entry.path, "utf8");
    return framePage(session, html, flags, head);
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
          stateDir,
          live: active().length,
        });
      if (method === "GET" && url.pathname === "/api/sessions")
        return reply(200, await sessionList(req));
      if (method === "POST" && url.pathname === "/api/seen") {
        sameOrigin(req);
        const data = await readBody(req, 250_000);
        return reply(200, await seen.add(data, listed()));
      }
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
          sessions.find((item) => !item.closed)?.url;
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
        const requested = path.resolve(data.sessionDir);
        const { session, created, card, joined } = await register(async () => {
          const created = !(await exists(path.join(requested, "status.json")));
          if (data.from === undefined)
            return { created, session: await adopt(requested) };
          return {
            created,
            ...(await startFrom(adopt, requested, created, data)),
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
          ...(card
            ? { parent: session.state.parent, proposal: card, joined }
            : {}),
          ...answer,
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
        if (method === "POST" && parts[2] === "action") {
          const data = await readBody(req, 10_000_000);
          return reply(200, await session.exclusive(() => session.act(data)));
        }
      }
      if (parts[0] === "s" && parts[1]) {
        const session = registry.get(parts[1]);
        requireValue(session, "Unknown session", 404);
        if (method !== "GET") sameOrigin(req);
        const rest = parts.slice(2);
        const round = () => decodeURIComponent(rest[1]);
        if (method === "GET" && parts.length === 2)
          return reply(302, "", "text/plain", {
            Location: session.base + "/",
          });
        if (method === "GET" && rest.length === 1 && rest[0] === "") {
          // The hub serves a session the reviewer closed as read-only, so a
          // tab left open on it cannot submit and wake an agent that has
          // finished.
          const closed = Boolean(session.state.dismissedAt);
          const flags = closed ? { closed: true } : {};
          const head = closed
            ? ""
            : firstAnswersHead(
                await firstAnswers(session, await sessionList(req)),
              );
          if (!session.state.current)
            return html(
              framePage(
                session,
                await assembleHome(session.listing().title),
                { home: true, ...flags },
                head,
              ),
            );
          return html(
            await roundPage(
              session,
              session.roundEntry(session.state.current.round),
              flags,
              head,
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
          return reply(200, session.browserView());
        // The browser sends no Origin header with a same-origin GET, so only
        // the Host check protects this read, as it protects the other reads.
        if (rest[0] === "api" && rest[1] === "draft" && rest.length === 2) {
          if (method === "GET") return reply(200, session.draftView());
          if (method === "POST") {
            const data = await readBody(req, 250_000);
            return reply(
              200,
              await session.exclusive(() => session.changeDraft(data)),
            );
          }
        }
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
          return reply(200, await session.exclusive(() => session.close()));
        }
        // Only start and open-agent have a body. The body of start contains
        // where the work runs, and both bodies can contain the reviewer's
        // message.
        const cardActions = {
          start: session.startProposal,
          decline: session.declineProposal,
          restore: session.restoreProposal,
          "open-agent": session.openAgent,
        };
        if (
          method === "POST" &&
          rest[0] === "api" &&
          rest[1] === "proposals" &&
          rest.length === 4 &&
          Object.hasOwn(cardActions, rest[3])
        ) {
          const data = ["start", "open-agent"].includes(rest[3])
            ? await readBody(req, 50_000)
            : null;
          const id = decodeURIComponent(rest[2]);
          return reply(
            200,
            await session.exclusive(() => cardActions[rest[3]](id, data)),
          );
        }
        /* readBytes caps the upload's size, and session.upload takes the
           type from the leading bytes, not a header, and chooses the file
           name itself. */
        if (method === "POST" && rest[0] === "api" && rest[1] === "upload") {
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
        /* The frame loads each uploaded image from this route by its ID,
           also after a reload, because the frame's draft stores only the ID
           and the hub stores the bytes. */
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
          return reply(
            200,
            await session.exclusive(() => session.removeUpload(rest[2])),
          );
        }
        if (
          method === "POST" &&
          rest[0] === "api" &&
          rest[1] === "threads" &&
          rest.length === 2
        ) {
          const data = await readBody(req, 250_000);
          return reply(
            201,
            await session.exclusive(() => session.startThread(data)),
          );
        }
        const threadActions = {
          messages: [201, session.addThreadMessage],
          acknowledge: [200, session.acknowledge],
        };
        if (
          method === "POST" &&
          rest[0] === "api" &&
          rest[1] === "threads" &&
          Object.hasOwn(threadActions, rest[3]) &&
          rest.length === 4
        ) {
          const data = await readBody(req, 250_000);
          const [code, act] = threadActions[rest[3]];
          return reply(
            code,
            await session.exclusive(() =>
              act(decodeURIComponent(rest[2]), data),
            ),
          );
        }
        if (method === "POST" && rest[0] === "api" && rest[1] === "feedback") {
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
            : error instanceof SyntaxError || error instanceof URIError
              ? 400
              : 500),
        { error: error.message },
      );
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
  let timer;
  let closing = null;
  let settle;
  const closed = new Promise((resolve) => (settle = resolve));
  const close = () => (closing ||= shutDown().then(settle));
  async function shutDown() {
    clearInterval(timer);
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      if ((await read(config.hubFile)).pid === process.pid)
        await fs.rm(config.hubFile, { force: true });
    } catch {
      /* The hub record is already gone or unreadable. */
    }
  }
  let quietCheckedAt = Date.now();
  timer = setInterval(
    async () => {
      const now = Date.now();
      if (now - quietCheckedAt >= config.quietCheckMs) {
        quietCheckedAt = now;
        for (const session of active())
          session
            .exclusive(() => session.wakeIfQuiet(now))
            .catch((error) =>
              log(`quiet check of session ${session.id}: ${error.message}`),
            );
      }
      if (active().length) lastLiveAt = now;
      else if (now - lastLiveAt > config.idleMs) {
        log("no live sessions; exiting");
        await close();
      }
    },
    Math.max(50, Math.min(5000, config.idleMs / 4, config.quietCheckMs)),
  );
  log(
    `hub ${version} listening on ${origin}${hostOrigin ? ` and ${hostOrigin}` : ""}`,
  );
  return { origin, hostOrigin, port, secret, close, closed };
}
