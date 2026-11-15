import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// These replies are shortened from what the Codex 0.160 daemon sends for a
// thread with a turn in progress.
export const turnInProgress = (thread, turn) => ({
  "thread/read": {
    thread: { id: thread, status: { type: "active", activeFlags: [] } },
  },
  "thread/turns/list": {
    data: [{ id: turn, status: "inProgress", items: [] }],
    nextCursor: null,
  },
  "turn/steer": { turnId: turn },
});

// frame() builds an unmasked text frame, as the daemon sends, and handles only
// a payload under 64 KiB.
function frame(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

// codexDaemon stands in for the app-server daemon of Codex 0.160, a WebSocket
// server on a Unix socket. It replies to each request with the matching entry
// of answers as the result, or as the error when the entry has an `error`
// field. For an entry that is a function, it replies with what the function
// returns for the request's params. It records every message the client sends
// in received. Like the daemon, it closes the connection on a frame that is not
// one masked text frame. It also refuses a thread/queue method when the
// connection's initialize did not declare the experimentalApi capability.
export async function codexDaemon(t, answers) {
  // macOS refuses a socket path over 104 bytes, so codexDaemon creates the
  // socket in a short directory of its own.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cx-"));
  const socket = path.join(directory, "d.sock");
  const received = [];
  const table = {
    initialize: {
      userAgent: "codex-tui/0.160.0 (Mac OS 14.4.0; arm64) Ghostty (pair)",
      codexHome: "/c",
      platformFamily: "unix",
      platformOs: "macos",
    },
    ...answers,
  };
  const server = net.createServer((client) => {
    let bytes = Buffer.alloc(0);
    let upgraded = false;
    let experimental = false;
    client.on("data", (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (!upgraded) {
        const end = bytes.indexOf("\r\n\r\n");
        if (end < 0) return;
        const key = /^Sec-WebSocket-Key: (\S+)/im.exec(
          bytes.subarray(0, end).toString(),
        )[1];
        const accept = crypto
          .createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        client.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        // The real daemon sends a notification as soon as a client connects,
        // before any reply.
        client.write(frame({ jsonrpc: "2.0", method: "account/updated" }));
        bytes = bytes.subarray(end + 4);
        upgraded = true;
      }
      while (bytes.length >= 2) {
        if (bytes[0] !== 0x81 || !(bytes[1] & 0x80)) return client.destroy();
        const short = bytes[1] & 0x7f;
        const start = short === 126 ? 4 : short === 127 ? 10 : 2;
        if (bytes.length < start) return;
        const length =
          short === 126
            ? bytes.readUInt16BE(2)
            : short === 127
              ? Number(bytes.readBigUInt64BE(2))
              : short;
        if (bytes.length < start + 4 + length) return;
        const mask = bytes.subarray(start, start + 4);
        const payload = bytes
          .subarray(start + 4, start + 4 + length)
          .map((byte, index) => byte ^ mask[index % 4]);
        bytes = bytes.subarray(start + 4 + length);
        const message = JSON.parse(payload);
        received.push(message);
        if (message.id === undefined) continue;
        if (message.method === "initialize")
          experimental = message.params.capabilities?.experimentalApi === true;
        const entry = table[message.method];
        const answer =
          message.method.startsWith("thread/queue/") && !experimental
            ? {
                error: {
                  code: -32600,
                  message: `${message.method} requires experimentalApi capability`,
                },
              }
            : ((typeof entry === "function"
                ? entry(message.params)
                : entry) ?? {
                error: { code: -32601, message: `no method ${message.method}` },
              });
        client.write(
          frame({
            jsonrpc: "2.0",
            id: message.id,
            ...(answer.error ? answer : { result: answer }),
          }),
        );
      }
    });
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { socket, received };
}

// codexCommand puts a stand-in codex first on PATH, and the stand-in logs the
// arguments of each run. With PAIR_TEST_FAIL set, the stand-in exits 1, as
// codex does when it cannot queue the message.
export async function codexCommand(t) {
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "pair-codex-"));
  const log = path.join(bin, "runs.jsonl");
  await fs.writeFile(
    path.join(bin, "codex"),
    `#!${process.execPath}
require("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.PAIR_TEST_FAIL) {
  console.error("thread gone");
  process.exit(1);
}
`,
    { mode: 0o755 },
  );
  const searched = process.env.PATH;
  process.env.PATH = bin + path.delimiter + searched;
  t.after(() => {
    process.env.PATH = searched;
    delete process.env.PAIR_TEST_FAIL;
    return fs.rm(bin, { recursive: true, force: true });
  });
  return {
    directory: bin,
    runs: () =>
      fs.readFile(log, "utf8").then(
        (text) => text.trim().split("\n").map(JSON.parse),
        () => [],
      ),
  };
}
