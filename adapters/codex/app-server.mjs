import { spawn } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import { codexInvocation } from "./invocation.mjs";

// The app-server daemon of Codex 0.160 speaks JSON-RPC over WebSocket on its
// control socket. A WebSocket client must mask each frame it sends, and the
// daemon sends its frames unmasked.

function frame(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const { length } = payload;
  // 0x81 marks the final frame of a text message. The second byte sets the mask
  // bit and contains a length below 126, or 126 or 127 for a 16-bit or 64-bit
  // length in the bytes after it.
  let header;
  if (length < 126) header = Buffer.from([0x81, 0x80 | length]);
  else if (length < 65536) {
    header = Buffer.from([0x81, 0x80 | 126, 0, 0]);
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header.set([0x81, 0x80 | 127]);
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  const mask = crypto.randomBytes(4);
  const masked = payload.map((byte, index) => byte ^ mask[index % 4]);
  return Buffer.concat([header, mask, masked]);
}

function readFrames(bytes) {
  const frames = [];
  while (bytes.length >= 2) {
    const short = bytes[1] & 0x7f;
    const start = short === 126 ? 4 : short === 127 ? 10 : 2;
    if (bytes.length < start) break;
    const length =
      short === 126
        ? bytes.readUInt16BE(2)
        : short === 127
          ? Number(bytes.readBigUInt64BE(2))
          : short;
    if (bytes.length < start + length) break;
    frames.push({
      opcode: bytes[0] & 0x0f,
      payload: bytes.subarray(start, start + length),
    });
    bytes = bytes.subarray(start + length);
  }
  return [frames, bytes];
}

// Codex's daemon listens on an AF_UNIX socket on Windows too, and Node on
// Windows opens a path only as a named pipe. On Windows, open() therefore
// starts codex stdio-to-uds, which relays the socket over its stdin and
// stdout. open() calls fail when the connection ends.
function open(socketPath, fail) {
  const closed = "the daemon closed the socket";
  if (process.platform !== "win32") {
    const socket = net.connect(socketPath);
    socket.on("error", fail);
    socket.on("close", () => fail(new Error(closed)));
    return { reader: socket, writer: socket, stop: () => socket.destroy() };
  }
  const bridge = spawn(...codexInvocation(["stdio-to-uds", socketPath]));
  let said = "";
  bridge.stderr.on("data", (chunk) => (said += chunk));
  // A write after the bridge exits fails, and close then reports the
  // bridge's error output.
  bridge.stdin.on("error", () => {});
  bridge.on("error", fail);
  bridge.on("close", () => fail(new Error(said.trim() || closed)));
  const stop = () => {
    for (const stream of bridge.stdio) stream.destroy();
    bridge.kill();
  };
  return { reader: bridge.stdout, writer: bridge.stdin, stop };
}

// The timeout counts from the connect, not from each request. Once it passes,
// every pending and later request rejects.
export function connect(socketPath, timeout) {
  return new Promise((resolve, reject) => {
    const answers = new Map();
    let ids = 0;
    let bytes = Buffer.alloc(0);
    let upgraded = false;
    let failure = null;
    const fail = (error) => {
      failure ||= error;
      clearTimeout(timer);
      reject(failure);
      for (const waiting of answers.values()) waiting.reject(failure);
      answers.clear();
      stop();
    };
    const { reader, writer, stop } = open(socketPath, fail);
    const timer = setTimeout(() => fail(new Error("timed out")), timeout);
    reader.on("data", (chunk) => {
      try {
        bytes = Buffer.concat([bytes, chunk]);
        if (!upgraded) {
          const end = bytes.indexOf("\r\n\r\n");
          if (end < 0) return;
          const status = bytes.subarray(0, bytes.indexOf("\r\n")).toString();
          if (!status.startsWith("HTTP/1.1 101 "))
            throw new Error(`the daemon refused the upgrade: ${status}`);
          bytes = bytes.subarray(end + 4);
          upgraded = true;
          resolve(client);
        }
        let frames;
        [frames, bytes] = readFrames(bytes);
        for (const { opcode, payload } of frames) {
          if (opcode !== 1) continue;
          // The daemon's notifications have no id, and its own requests
          // have a method.
          const message = JSON.parse(payload);
          const waiting = answers.get(message.id);
          if (!waiting || message.method !== undefined) continue;
          answers.delete(message.id);
          if (message.error) waiting.reject(new Error(message.error.message));
          else waiting.resolve(message.result);
        }
      } catch (error) {
        fail(error);
      }
    });
    const key = crypto.randomBytes(16).toString("base64");
    writer.write(
      [
        "GET / HTTP/1.1",
        "Host: localhost",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"),
    );
    const client = {
      request(method, params) {
        if (failure) return Promise.reject(failure);
        const id = ++ids;
        return new Promise((resolve, reject) => {
          answers.set(id, { resolve, reject });
          writer.write(frame({ jsonrpc: "2.0", id, method, params }));
        });
      },
      notify(method) {
        writer.write(frame({ jsonrpc: "2.0", method }));
      },
      close: () => fail(new Error("closed")),
    };
  });
}
