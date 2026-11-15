import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandLine } from "../../src/shared/processes.mjs";
import { connect } from "./app-server.mjs";
import { codexInvocation } from "./invocation.mjs";

export const name = "Codex";

// Codex exports the thread ID to the commands it runs.
export const command = "codex";
export const variables = ["CODEX_THREAD_ID"];
export const unwakeable =
  "Tell the user that this Codex session exports no CODEX_THREAD_ID, so the hub cannot wake it, and stop.";

export const identity = (target) => target.thread;

// Codex gives a SessionStart hook the thread ID as session_id on stdin, and not
// in the hook's environment.
export const hookVariables = (input) => ({ CODEX_THREAD_ID: input.session_id });

// launch returns the command line that starts a new session with a prompt.
export const launch = ({ prompt }) => [command, prompt];

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

async function openDaemon(socket) {
  const daemon = await connect(socket, 5000);
  try {
    // The thread/queue methods are experimental in Codex 0.160.
    await daemon.request("initialize", {
      clientInfo: { name: "pair", version },
      capabilities: { experimentalApi: true },
    });
  } catch (error) {
    daemon.close();
    throw error;
  }
  daemon.notify("initialized");
  return daemon;
}

// readThread rejects when the daemon does not answer. thread/read gives a
// subagent's source from disk when the daemon has not loaded its thread, as
// when its parent runs in-process.
async function readThread({ thread, socket }) {
  const daemon = await openDaemon(socket);
  try {
    return (await daemon.request("thread/read", { threadId: thread })).thread;
  } finally {
    daemon.close();
  }
}

// A subagent has a thread of its own, which the parent spawned.
export async function parentSession(target) {
  const spawn = (await readThread(target)).source?.subAgent?.thread_spawn;
  return spawn
    ? { sessionId: spawn.parent_thread_id, nickname: spawn.agent_nickname }
    : null;
}

// pair message asks the parent's agent to pass a message on to its subagent
// with followup_task. Codex 0.169 gives a subagent a random nickname, such as
// Goodall, and an agent path made of the name the parent gave it, such as
// /root/echo, which the parent's tools show as the subagent's agent ID.
// subagentTool finds the subagent among the threads the parent spawned, by
// either name, and names its agent path, or its thread ID when it has none.
export async function subagentTool({ thread, socket }, name) {
  const daemon = await openDaemon(socket);
  const spawned = [];
  try {
    let cursor = null;
    do {
      const page = await daemon.request("thread/list", {
        parentThreadId: thread,
        cursor,
      });
      spawned.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
  } finally {
    daemon.close();
  }
  const agentPath = (child) => child.source?.subAgent?.thread_spawn?.agent_path;
  const names = (child) =>
    [agentPath(child)?.split("/").at(-1), child.agentNickname].filter(Boolean);
  const subagent = spawned.find((child) =>
    names(child).some((each) => each.toLowerCase() === name.toLowerCase()),
  );
  if (subagent)
    return `followup_task and target ${agentPath(subagent) ?? subagent.id}`;
  const known = spawned.map((child) => {
    const [first, ...others] = names(child);
    return others.length ? `${first} (${others.join(", ")})` : first;
  });
  throw new Error(
    `The Codex session has no subagent named ${name}. ${known.length > 1 ? `Its subagents are ${known.join(", ")}.` : known.length ? `Its subagent is ${known[0]}.` : "It has no subagents."}`,
  );
}

// Codex started with no -c override runs its sessions' threads on the
// app-server daemon, so each command's nearest codex ancestor is the daemon,
// which runs as codex app-server, serves every such session and keeps
// running after they exit. The daemon unloads a thread about a minute after
// its session exits, and keeps the thread of a running session loaded while
// the session is idle.
const isDaemon = (cli) => /\bapp-server\b/.test(commandLine(cli) ?? "");
export const sharesProcess = isDaemon;
export async function running(target, cli) {
  if (!isDaemon(cli)) return true;
  return (await readThread(target)).status.type !== "notLoaded";
}

// When a turn of the thread is in progress on the daemon, deliver() sends the
// line into the turn with turn/steer. When the daemon runs the thread and no
// turn is in progress, deliver() adds the line to the thread's queue with
// thread/queue/add, and start() starts a turn with it. In every other case, and
// after any error before the line is queued, wake() runs codex queue. Codex
// then starts a turn with the line at once when it is idle, and otherwise reads
// the line when its turn ends. steerable is true when the daemon runs the
// thread, because a later line can then reach a turn in progress.
//
// Codex refuses input from another process to a subagent that the daemon has
// not loaded, as when the subagent's parent runs in-process. When thread/read
// returns a thread_spawn source, deliver() sends the parent thread, by the same
// steer or queue, a line with the instruction to pass the hub's line on.
// steerable is then false, because the subagent reads the line only after its
// parent passes it on.
export async function wake(target, line, run) {
  const { thread, text, relayed, sent, steered, steerable, waiting } =
    await deliver(target, line);
  if (waiting)
    throw new Error(
      `Codex added the line to the queue of thread ${thread} and started no turn with it: ${waiting}`,
    );
  if (!sent) await queue(thread, text, run);
  if (relayed) return { via: "parent", steerable: false };
  return { via: steered ? "steer" : "queue", steerable };
}

// codex queue takes the message as an argument, and the system refuses to
// start a command line over its limit, such as 32,767 characters on Windows.
// Node then fails with E2BIG or ENAMETOOLONG.
async function queue(thread, text, run) {
  try {
    await run(
      ...codexInvocation(["queue", "--thread", thread, "--message", text]),
    );
  } catch (error) {
    if (!/\b(E2BIG|ENAMETOOLONG)\b/.test(error.message)) throw error;
    throw new Error(
      `The Codex daemon did not take the message, so pair ran codex queue, which takes the message as an argument. The system refused to start codex queue with a message of ${text.length} characters. Send a shorter message.`,
    );
  }
}

// relay() instructs the parent to use followup_task, which starts a turn for an
// idle subagent. send_message only puts the line in the subagent's mailbox, and
// no turn starts to read it. Codex's older multi-agent tools have send_input
// instead. Each tool takes the subagent's thread ID as its target.
function relay(thread, nickname, line) {
  const subagent = nickname
    ? `${nickname} (agent ID ${thread})`
    : `with agent ID ${thread}`;
  return `pair: the hub cannot send messages to your subagent ${subagent}, which runs a pair session. Pass it the message below, unchanged, with followup_task and target ${thread}, which starts a turn for it. If you have no followup_task, use send_input. Do not run the commands in it yourself.\n\n${line}`;
}

// Codex starts a queued line by itself when the thread goes idle, except after
// the user interrupts a turn, when the line stays queued until the user sends a
// message. thread/queue/start starts the line in that case too.
// thread/queue/start fails when Codex has already started the line or when a
// turn of the thread is in progress, and Codex then reads the line when that
// turn ends. start() returns the error of thread/queue/start when the line is
// still queued on an idle thread, and null otherwise.
async function start(daemon, threadId, queuedSubmissionId) {
  try {
    await daemon.request("thread/queue/start", {
      threadId,
      queuedSubmissionId,
    });
    return null;
  } catch (error) {
    const { data } = await daemon.request("thread/queue/list", { threadId });
    const { thread } = await daemon.request("thread/read", { threadId });
    const queued = data.some(({ id }) => id === queuedSubmissionId);
    return queued && thread.status.type === "idle" ? error.message : null;
  }
}

// A target that an older pair recorded has no socket, so deliver() looks for
// the socket under the hub's CODEX_HOME. The result contains the thread, and
// the text for codex queue to send when the daemon accepted no line.
async function deliver({ thread, socket = controlSocket(process.env) }, line) {
  const delivery = {
    thread,
    text: line,
    relayed: false,
    sent: false,
    steered: false,
    steerable: false,
    waiting: null,
  };
  let daemon;
  try {
    daemon = await openDaemon(socket);
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
    if (status.type === "active") {
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
      delivery.sent = delivery.steered = true;
      return delivery;
    }
    if (status.type !== "idle") return delivery;
    const { queuedSubmission } = await daemon.request("thread/queue/add", {
      threadId: delivery.thread,
      input: [{ type: "text", text: delivery.text }],
      clientUserMessageId: crypto.randomUUID(),
    });
    delivery.sent = true;
    delivery.waiting = await start(
      daemon,
      delivery.thread,
      queuedSubmission.id,
    );
    return delivery;
  } catch {
    return delivery;
  } finally {
    daemon?.close();
  }
}
