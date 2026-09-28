import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { listen, send } from "../../adapters/listener.mjs";

test("a wake resolves once the listener answers ok, and rejects with its reason", async (t) => {
  const received = [];
  const listener = listen(async (message) => {
    if (message.text === "refuse") throw new Error("the session is busy");
    received.push(message);
  });
  t.after(() => listener.close());
  await send(listener.socket, { session: "s-1", text: "hello" });
  assert.deepEqual(received, [{ session: "s-1", text: "hello" }]);
  await assert.rejects(send(listener.socket, { text: "refuse" }), {
    message: "the session is busy",
  });
});

test("a wake to a CLI that has exited says so", async (t) => {
  // A clean exit closes the listener, which deletes the socket.
  const closed = listen(() => {});
  closed.close();
  await assert.rejects(send(closed.socket, { text: "hello" }), {
    message: `the agent CLI has exited (ENOENT ${closed.socket})`,
  });
  // A killed CLI leaves its socket file with nothing listening on it. The
  // stand-in CLI prints its socket once the file exists.
  const listener = new URL("../../adapters/listener.mjs", import.meta.url);
  const cli = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import fs from "node:fs";
import { listen } from ${JSON.stringify(listener.href)};
const { socket } = listen(() => {});
const ready = () => fs.existsSync(socket) ? console.log(socket) : setTimeout(ready, 10);
ready();`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  t.after(() => cli.kill("SIGKILL"));
  const socket = await new Promise((resolve) =>
    cli.stdout.once("data", (chunk) => resolve(String(chunk).trim())),
  );
  t.after(() =>
    fs.rmSync(path.dirname(socket), { recursive: true, force: true }),
  );
  cli.kill("SIGKILL");
  await new Promise((resolve) => cli.once("exit", resolve));
  assert.equal(fs.existsSync(socket), true);
  await assert.rejects(send(socket, { text: "hello" }), {
    message: `the agent CLI has exited (ECONNREFUSED ${socket})`,
  });
});
