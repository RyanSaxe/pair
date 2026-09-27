import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
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
import { loadSession } from "./session/state.mjs";
import { readBytes, uploadBytes } from "./session/uploads.mjs";
import { adapters } from "./wake.mjs";

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
  // A session directory can be reached by more than one path, such as
  // /tmp/… and /private/tmp/… on macOS. The hub keys a session by the real
  // path of its parent and its own name, because a new session's directory
  // does not exist yet when it registers.
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
      session = await loadSession(directory, config, origin);
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
        const session = await register(() =>
          adopt(path.resolve(data.sessionDir)),
        );
        const { directory } = session;
        const next = await session.exclusive(() =>
          session.hold(data.wake, data.start === true),
        );
        // The wake target stays the holder's when another agent registers.
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
        if (method === "POST" && parts[2] === "action") {
          const data = await readBody(req, 10_000_000);
          return reply(200, await session.exclusive(() => session.act(data)));
        }
      }
      if (parts[0] === "s" && parts[1]) {
        const session = registry.get(parts[1]);
        requireValue(session, "Unknown session", 404);
        /* The hub is a local review tool. It binds 127.0.0.1 unless the
           operator sets PAIR_HUB_HOST, and browser routes carry no token by
           design (see session.md), so the same-origin check is what stands
           between a page in another tab and this session. */
        if (method !== "GET")
          requireValue(
            req.headers.origin === `http://${req.headers.host}`,
            "Unauthorized source",
            403,
          );
        const rest = parts.slice(2);
        const round = () => decodeURIComponent(rest[1]);
        if (method === "GET" && parts.length === 2)
          return reply(302, "", "text/plain", {
            Location: session.base + "/",
          });
        if (method === "GET" && rest.length === 1 && rest[0] === "") {
          if (!session.state.current)
            return reply(200, "No round published yet.", "text/plain");
          // A session the reviewer closed is read-only, so no tab left open
          // on it can submit and wake an agent that will never run again.
          return html(
            await roundPage(
              session,
              session.roundEntry(session.state.current.round),
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
          return reply(200, await session.exclusive(() => session.dismiss()));
        }
        /* This route writes bytes, so it also caps the size and the count,
           decides the type from the leading bytes rather than a header, and
           names the file itself. */
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
          return reply(
            200,
            await session.exclusive(() => session.removeUpload(rest[2])),
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
  let timer;
  // The hub closes once, however many callers ask, and closed settles when
  // it has, so the hub command knows when to exit.
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
      /* The record is already gone or belongs to a newer hub. */
    }
  }
  timer = setInterval(
    async () => {
      const now = Date.now();
      if (active().length) lastLiveAt = now;
      else if (now - lastLiveAt > config.idleMs) {
        log("no live sessions; exiting");
        await close();
      }
    },
    Math.min(5000, Math.max(50, config.idleMs / 4)),
  );
  log(
    `hub ${version} listening on ${origin}${hostOrigin ? ` and ${hostOrigin}` : ""}`,
  );
  return { origin, hostOrigin, port, secret, close, closed };
}
