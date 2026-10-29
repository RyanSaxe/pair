import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
  // close() deletes the socket file, so a send after a clean exit fails with
  // ENOENT.
  const closed = listen(() => {});
  closed.close();
  await assert.rejects(send(closed.socket, { text: "hello" }), {
    message: `the agent CLI has exited (ENOENT ${closed.socket})`,
  });
  // A killed agent CLI leaves its socket file behind with nothing listening on
  // it. The stand-in CLI prints the socket path once the file exists, and the
  // test waits for that line before it kills the CLI.
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
  // On Windows the socket is a named pipe, which closes with the process.
  // listen() names its directory after the pipe, inside the temp directory.
  const windows = process.platform === "win32";
  const directory = windows
    ? path.join(os.tmpdir(), path.basename(socket))
    : path.dirname(socket);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  cli.kill("SIGKILL");
  await new Promise((resolve) => cli.once("exit", resolve));
  assert.equal(fs.existsSync(socket), !windows);
  await assert.rejects(send(socket, { text: "hello" }), {
    message: `the agent CLI has exited (${windows ? "ENOENT" : "ECONNREFUSED"} ${socket})`,
  });
});
