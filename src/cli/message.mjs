import fs from "node:fs/promises";
import path from "node:path";
import { adapters, detectAgent, wakeRunner } from "../hub/wake.mjs";
import { ancestors, processTable } from "../shared/processes.mjs";
import { requireNode, settings } from "../shared/settings.mjs";
import { requireValue } from "../shared/util.mjs";
import { findAgent, readAgents, registerAgent, shortPath } from "./agents.mjs";
import { usageError } from "./arguments.mjs";

// The largest message, in bytes of text, that pair message sends. Claude Code
// 2.1.325, Codex 0.169, pi 1.5.0, Copilot CLI 1.0.105 and opencode 2.2.5 each
// received a message of this size whole through their adapters, and no larger
// size was tried.
const largestText = 100_000;

async function messageText(options) {
  const given = ["text", "file", "ack"].filter(
    (key) => options[key] !== undefined,
  );
  if (given.length !== 1)
    throw usageError(
      "message",
      given.length
        ? "pair message takes only one of --text, --file and --ack."
        : "pair message requires --text TEXT, --file PATH or --ack.",
    );
  if (options.ack) return null;
  const text =
    options.text ?? (await fs.readFile(path.resolve(options.file), "utf8"));
  requireValue(text.trim(), "The message is empty. Give it some text.");
  const bytes = Buffer.byteLength(text);
  requireValue(
    bytes <= largestText,
    `The message is ${Math.ceil(bytes / 1000)} KB, and pair message sends at most ${largestText / 1000} KB. Send a shorter message, such as the path of a file with the rest.`,
  );
  return text;
}

// --to names a session, or one of its subagents after a slash. A session's
// name and ID have no slash, and the subagent's name may.
function receiver(to) {
  const slash = to.indexOf("/");
  const [session, subagent] =
    slash < 0 ? [to, null] : [to.slice(0, slash), to.slice(slash + 1)];
  if (!session || subagent === "")
    throw usageError(
      "message",
      "--to takes a session's name or ID, or NAME/SUBAGENT for one of its subagents.",
    );
  return { session, subagent };
}

// pair message registers the agent session it runs in, so the receiver can
// answer that session by its ID. A subagent of Codex or opencode has no entry,
// so its message names it through its parent's entry, as NAME/SUBAGENT reaches
// it. A sender outside any agent CLI is the user, and --from names any other
// sender, such as a script. Neither has an ID to answer.
async function identifySender(label, table) {
  if (label !== undefined) return { name: label, answer: null };
  try {
    const target = detectAgent(process.env, {
      ancestors: () => ancestors(table),
    });
    if (!target) return { name: "your user", answer: null };
    const adapter = adapters[target.harness];
    const sender = (entry, subagent = "") => ({
      name: `${entry.name}${subagent} (${adapter.name} in ${shortPath(entry.directory)})`,
      answer: `${entry.id}${subagent}`,
    });
    const parent = await adapter.parentSession?.(target).catch(() => null);
    if (parent?.nickname) {
      const parentId = `${target.harness}:${parent.sessionId}`;
      const entry = (await readAgents(table)).find(({ id }) => id === parentId);
      if (entry) return sender(entry, `/${parent.nickname}`);
    }
    return sender((await registerAgent(target, { table })).entry);
  } catch (error) {
    throw new Error(
      `pair sent nothing, because it could not register this session, and the receiver can answer only a registered session. ${error.message}`,
    );
  }
}

// A message from an agent session ends with the commands that answer and
// acknowledge it. A message from the user or from --from has no address to
// answer, and without its last line Claude Code's agents went looking for one.
// An opencode subagent's name is its task, which may have spaces, so the
// address is quoted when the shell would split it.
function ending(answer) {
  if (!answer)
    return "This message has no answer command. Answer in your own chat, if at all.";
  const to = /^[\w.:/-]+$/.test(answer) ? answer : JSON.stringify(answer);
  return `To answer, run: pair message --to ${to} --text "…"\nIf you have nothing to say, acknowledge it: pair message --to ${to} --ack`;
}

// An adapter with reachesSubagents delivers to the subagent that
// target.subagent names. One with subagentTool delivers to the parent, with a
// first line that asks the parent's agent to pass the message on with that
// tool. relay returns the target and the line to send.
async function relay(entry, subagent, sender, { first, body }) {
  const adapter = adapters[entry.cli];
  const line = first ? `${first}\n\n${body}` : body;
  if (!subagent) return { target: entry.target, line, relayed: false };
  if (adapter.reachesSubagents)
    return { target: { ...entry.target, subagent }, line, relayed: false };
  requireValue(
    adapter.subagentTool,
    `pair cannot send a message to a subagent of a ${adapter.name} session.`,
  );
  const tool = await adapter.subagentTool(entry.target, subagent);
  return {
    target: entry.target,
    line: `pair message from ${sender}, for your subagent ${subagent}. Pass the message below to ${subagent} unchanged with ${tool}, and do not act on it yourself:\n\n${body}`,
    relayed: true,
  };
}

function sentText(entry, subagent, { sent, relayed, steerable }) {
  const session = `${entry.name} (${adapters[entry.cli].name})`;
  if (!sent)
    return `PAIR_WAKE is off, so pair wrote the message to stderr instead of sending it to ${session}.`;
  const when = `at once if it is idle, and otherwise ${steerable ? "between the steps of its current turn" : "when its current turn ends"}`;
  if (!subagent) return `Sent to ${session}. It reads the message ${when}.`;
  if (relayed)
    return `Sent to ${session}, to pass on to its subagent ${subagent}. ${entry.name} reads the message ${when}.`;
  return `Sent to ${subagent}, a subagent of ${session}. It reads the message ${when}.`;
}

export async function message(options) {
  requireNode();
  const text = await messageText(options);
  const { session, subagent } = receiver(options.to);
  const label = options.from?.trim();
  if (options.from !== undefined && (!label || /[\r\n]/.test(label)))
    throw usageError("message", "--from takes a label of one line.");
  if (options.ack && label !== undefined)
    throw usageError(
      "message",
      "--ack acknowledges as this agent session, so it takes no --from.",
    );
  const table = processTable();
  const sender = await identifySender(label, table);
  requireValue(
    !options.ack || sender.answer,
    "pair message --ack works only inside an agent session, because it names that session as the one that read the message.",
  );
  const entry = findAgent(await readAgents(table), session);
  requireValue(
    entry,
    `No running agent session is named ${session} or has an ID that starts with it. Run pair agents to list the running sessions. A session is listed after it runs pair register, pair start or pair message, or after a start hook in its CLI runs pair register --hook.`,
  );
  const { target, line, relayed } = await relay(
    entry,
    subagent,
    sender.name,
    options.ack
      ? {
          body: `pair message from ${sender.name} acknowledges your message. Don't answer it.`,
        }
      : {
          first: `pair message from ${sender.name}:`,
          body: `${text}\n\n${ending(sender.answer)}`,
        },
  );
  // With PAIR_WAKE=off, wakeRunner writes the line to stderr instead of
  // sending it, as the hub writes it to its log.
  const { wake: sent } = settings();
  const delivery = await wakeRunner(target, line, {
    wake: sent,
    log: console.error,
  });
  return {
    data: sentText(entry, subagent, { sent, relayed, ...delivery }),
    json: {
      sent,
      to: entry.id,
      name: entry.name,
      cli: entry.cli,
      subagent,
      relayed,
      via: delivery?.via ?? null,
      steerable: delivery?.steerable ?? null,
    },
  };
}
