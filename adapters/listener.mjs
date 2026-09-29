import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// Inside pi or opencode: a socket in a directory only this user can open.
// A connection carries one JSON line, and the listener answers "ok" once the
// CLI has taken the message, or the reason it refused. Bun, which runs
// opencode's plugins, closes a half-closed socket, so neither side half-closes
// before the answer.
export function listen(deliver) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pair-"));
  const socket = path.join(directory, "wake.sock");
  const server = net.createServer((connection) => {
    let text = "";
    connection.setEncoding("utf8");
    connection.on("data", async (chunk) => {
      text += chunk;
      if (!text.includes("\n")) return;
      try {
        await deliver(JSON.parse(text.slice(0, text.indexOf("\n"))));
        connection.end("ok\n");
      } catch (error) {
        connection.end(`${error.message}\n`);
      }
    });
  });
  server.listen(socket);
  return {
    socket,
    close() {
      server.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

// A clean exit deletes the socket (ENOENT). A killed CLI leaves the socket
// file with nothing listening on it (ECONNREFUSED).
const exited = new Set(["ENOENT", "ECONNREFUSED"]);

// In the hub: send one message and wait for the listener's answer.
export function send(socket, message) {
  return new Promise((resolve, reject) => {
    let reply = "";
    const client = net.connect(socket);
    client.setTimeout(5000, () => client.destroy(new Error("timed out")));
    client.setEncoding("utf8");
    client.on("data", (chunk) => (reply += chunk));
    client.on("error", (error) =>
      reject(
        exited.has(error.code)
          ? new Error(`the agent CLI has exited (${error.code} ${socket})`)
          : error,
      ),
    );
    client.on("end", () =>
      reply.trim() === "ok"
        ? resolve()
        : reject(
            new Error(reply.trim() || "the listener closed without an answer"),
          ),
    );
    client.write(JSON.stringify(message) + "\n");
  });
}
