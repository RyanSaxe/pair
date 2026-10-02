import crypto from "node:crypto";
import net from "node:net";

// A JSON-RPC client for the app-server daemon of Codex 0.160, which speaks
// WebSocket on its control socket. The client sends each message as one
// masked text frame and reads the daemon's unmasked frames.

function frame(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const { length } = payload;
  // 0x81 starts the final frame of a text message. The second byte sets the
  // mask bit and gives a length below 126, or 126 or 127 for a 16-bit or
  // 64-bit length after it.
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

// The complete frames at the start of the bytes, and the bytes after them.
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

// Connects and upgrades the socket. Every request made on the connection
// rejects once `timeout` milliseconds have passed since the connect, and
// close() ends the connection.
export function connect(socketPath, timeout) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
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
      socket.destroy();
    };
    const timer = setTimeout(() => fail(new Error("timed out")), timeout);
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("the daemon closed the socket")));
    socket.on("data", (chunk) => {
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
    socket.write(
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
          socket.write(frame({ jsonrpc: "2.0", id, method, params }));
        });
      },
      notify(method) {
        socket.write(frame({ jsonrpc: "2.0", method }));
      },
      close: () => fail(new Error("closed")),
    };
  });
}
