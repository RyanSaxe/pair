import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "./app-server.mjs";

export const name = "Codex";

// Codex exports the thread ID to the commands it runs.
export const command = "codex";
export const variables = ["CODEX_THREAD_ID"];
export const unwakeable =
  "this Codex session exports no CODEX_THREAD_ID, so it cannot be woken.";

export const identity = (target) => target.thread;

// Codex 0.160 runs its threads on an app-server daemon, which listens on a
// control socket under CODEX_HOME.
const controlSocket = (env) =>
  path.join(
    env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    "app-server-control",
    "app-server-control.sock",
  );

export const detect = (env) => ({
  harness: "codex",
  thread: env.CODEX_THREAD_ID,
  socket: controlSocket(env),
});

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

// When a turn of the thread is in progress on the daemon, the adapter sends
// the line into it with turn/steer. In every other case, and on any error,
// it runs codex queue: Codex starts a turn with the line at once when it is
// idle, and otherwise reads the line when its turn ends. steerable is true
// when the daemon runs the thread, so that a later line can reach a turn in
// progress.
export async function wake(target, line, run) {
  const { steered, steerable } = await steer(target, line);
  if (!steered)
    await run("codex", ["queue", "--thread", target.thread, "--message", line]);
  return { via: steered ? "steer" : "queue", steerable };
}

// A target that an older pair recorded has no socket, and the adapter looks
// for the socket under the hub's CODEX_HOME.
async function steer({ thread, socket = controlSocket(process.env) }, line) {
  let daemon;
  let steerable = false;
  try {
    daemon = await connect(socket, 5000);
    await daemon.request("initialize", {
      clientInfo: { name: "pair", version },
    });
    daemon.notify("initialized");
    const { status } = (
      await daemon.request("thread/read", { threadId: thread })
    ).thread;
    steerable = status.type === "idle" || status.type === "active";
    if (status.type !== "active") return { steered: false, steerable };
    const [turn] = (
      await daemon.request("thread/turns/list", {
        threadId: thread,
        limit: 1,
        itemsView: "notLoaded",
      })
    ).data;
    if (turn?.status !== "inProgress") return { steered: false, steerable };
    await daemon.request("turn/steer", {
      threadId: thread,
      expectedTurnId: turn.id,
      input: [{ type: "text", text: line }],
    });
    return { steered: true, steerable };
  } catch {
    return { steered: false, steerable };
  } finally {
    daemon?.close();
  }
}
