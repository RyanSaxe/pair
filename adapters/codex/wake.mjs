import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "./app-server.mjs";

export const name = "Codex";

// Codex exports the thread ID to the commands it runs.
export const command = "codex";
export const variables = ["CODEX_THREAD_ID"];
export const unwakeable =
  "Tell the user that this Codex session exports no CODEX_THREAD_ID, so the hub cannot wake it, and stop.";

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
//
// Codex refuses input from another process to a subagent that a thread
// spawned when the daemon has not loaded the subagent, as when its parent
// runs in-process. When thread/read gives a thread_spawn source, the adapter
// sends the parent thread, by the same steer or queue, a line that asks it
// to pass the hub's line on. The subagent reads the line only after its
// parent passes it on, so steerable is false.
export async function wake(target, line, run) {
  const { thread, text, relayed, steered, steerable } = await deliver(
    target,
    line,
  );
  if (!steered)
    await run("codex", ["queue", "--thread", thread, "--message", text]);
  if (relayed) return { via: "parent", steerable: false };
  return { via: steered ? "steer" : "queue", steerable };
}

// The parent passes the line on with followup_task, which starts a turn for
// an idle subagent. send_message only leaves the line in the subagent's
// mailbox, where it waits for a turn that nothing starts. Codex's older
// multi-agent tools have send_input instead. Each takes the subagent's
// thread ID as its target.
function relay(thread, nickname, line) {
  const subagent = nickname
    ? `${nickname} (agent ID ${thread})`
    : `with agent ID ${thread}`;
  return `pair: the hub cannot send messages to your subagent ${subagent}, which runs a pair session. Pass it the message below, unchanged, with followup_task and target ${thread}, which starts a turn for it. If you have no followup_task, use send_input. Do not run the commands in it yourself.\n\n${line}`;
}

// A target that an older pair recorded has no socket, and the adapter looks
// for the socket under the hub's CODEX_HOME. The result names the thread
// and the text that codex queue sends when the line was not steered.
async function deliver({ thread, socket = controlSocket(process.env) }, line) {
  const delivery = {
    thread,
    text: line,
    relayed: false,
    steered: false,
    steerable: false,
  };
  let daemon;
  try {
    daemon = await connect(socket, 5000);
    await daemon.request("initialize", {
      clientInfo: { name: "pair", version },
    });
    daemon.notify("initialized");
    const read = async () =>
      (await daemon.request("thread/read", { threadId: delivery.thread }))
        .thread;
    let { status, source } = await read();
    const spawn = source?.subAgent?.thread_spawn;
    if (spawn) {
      delivery.thread = spawn.parent_thread_id;
      delivery.text = relay(thread, spawn.agent_nickname, line);
      delivery.relayed = true;
      ({ status } = await read());
    }
    delivery.steerable = status.type === "idle" || status.type === "active";
    if (status.type !== "active") return delivery;
    const [turn] = (
      await daemon.request("thread/turns/list", {
        threadId: delivery.thread,
        limit: 1,
        itemsView: "notLoaded",
      })
    ).data;
    if (turn?.status !== "inProgress") return delivery;
    await daemon.request("turn/steer", {
      threadId: delivery.thread,
      expectedTurnId: turn.id,
      input: [{ type: "text", text: delivery.text }],
    });
    delivery.steered = true;
    return delivery;
  } catch {
    return delivery;
  } finally {
    daemon?.close();
  }
}
