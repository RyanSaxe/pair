import fs from "node:fs/promises";
import path from "node:path";
import { adapters, detectAgent, detectWake, wakeRunner } from "../hub/wake.mjs";
import { ancestors } from "../shared/processes.mjs";
import { requireNode, settings } from "../shared/settings.mjs";
import { requireValue } from "../shared/util.mjs";
import { usageError } from "./arguments.mjs";
import {
  findAgent,
  readAgents,
  registerAgent,
  shortId,
  shortPath,
} from "./agents.mjs";

// --to takes NAME/SUBAGENT and an ID, which has a colon, so a name has neither.
const namePattern = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,63}$/u;

// The wake target contains Claude Code's inbox token, so pair prints every
// field of an entry but the target.
const shown = ({ target, ...entry }) => entry;

// A CLI writes its start hook's JSON to stdin and closes it. hookInput reads
// stdin to its end, which an empty stdin such as /dev/null reaches at once.
async function hookInput() {
  if (process.stdin.isTTY) return null;
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function registerSession(options) {
  requireNode();
  if (options.name !== undefined && !namePattern.test(options.name))
    throw usageError(
      "register",
      "--name takes up to 64 letters, digits and hyphens, starting with a letter or digit.",
    );
  const input = options.hook ? await hookInput() : null;
  // pair register talks to no hub, so it walks the ancestors as registering
  // does, with PowerShell on Windows, where ps finds none. A Codex start hook
  // has no CODEX_THREAD_ID, so only a codex ancestor chooses Codex for it.
  const target = detectWake(process.env, { ancestors }, input);
  const { entry, running } = await registerAgent(target, {
    name: options.name,
  });
  const id = shortId(
    entry.id,
    running.map((other) => other.id),
  );
  return {
    data: `Registered ${entry.name}, ${id}, in ${shortPath(entry.directory)}.`,
    json: shown(entry),
  };
}

// A CLI's start hook runs pair register --hook, and a failed hook must not
// stop the CLI from starting, so with --hook pair register prints its error
// and exits 0.
export async function register(options) {
  if (!options.hook) return registerSession(options);
  try {
    return await registerSession(options);
  } catch (error) {
    console.error(`pair: ${error.message}`);
    return null;
  }
}

function table(rows) {
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column] + 2),
        )
        .join(""),
    )
    .join("\n");
}

export async function agents() {
  requireNode();
  const { running } = await readAgents();
  const ids = running.map((entry) => entry.id);
  const rows = running.map((entry) => [
    entry.name,
    adapters[entry.cli]?.name ?? entry.cli,
    shortPath(entry.directory),
    entry.branch ?? "-",
    shortId(entry.id, ids),
  ]);
  return {
    data: rows.length
      ? table([["NAME", "CLI", "DIRECTORY", "BRANCH", "ID"], ...rows])
      : "No registered agent session is running.",
    json: { agents: running.map(shown) },
  };
}

// The largest message, in bytes of text, that pair message sends. Claude Code
// 2.1.325, Codex 0.169 and pi 1.5.0 each received a message of this size whole
// through their adapters, and no larger size was tried.
const largestText = 100_000;

async function messageText(options) {
  if (options.text !== undefined && options.file !== undefined)
    throw usageError(
      "message",
      "pair message takes --text or --file, not both.",
    );
  if (options.text === undefined && options.file === undefined)
    throw usageError(
      "message",
      "pair message requires --text TEXT or --file PATH.",
    );
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

function senderLabel(from) {
  const label = from.trim();
  if (!label || /[\r\n]/.test(label))
    throw usageError("message", "--from takes a label of one line.");
  return label;
}

// pair message registers the agent session it runs in, so the receiver can
// answer that session by its ID. A sender outside any agent CLI is the user,
// and --from names any other sender, such as a script. Neither has an ID to
// answer.
async function identifySender(label) {
  const unregistered = async (name) => ({
    name,
    answer: null,
    running: (await readAgents()).running,
  });
  if (label !== undefined) return unregistered(label);
  let registered;
  try {
    // pair message talks to no hub, so it walks the ancestors as pair
    // register does, with PowerShell on Windows, where ps finds none.
    const target = detectAgent(process.env, { ancestors });
    if (!target) return unregistered("your user");
    registered =
      (await subagentSender(target)) ?? (await registerAgent(target));
  } catch (error) {
    throw new Error(
      `pair sent nothing, because it could not register this session, and the receiver can answer only a registered session. ${error.message}`,
    );
  }
  const { entry, running, subagent } = registered;
  const address = subagent ? `${entry.id}/${subagent}` : entry.id;
  const name = subagent ? `${entry.name}/${subagent}` : entry.name;
  return {
    name: `${name} (${adapters[entry.cli].name} in ${shortPath(entry.directory)})`,
    answer: address,
    running,
  };
}

// A Codex subagent has a session of its own, which pair does not list, so a
// message from it names the subagent through its parent's entry, as
// NAME/SUBAGENT reaches it. subagentSender returns null for any other sender,
// and for a subagent whose parent has no entry, which registerAgent refuses.
async function subagentSender(target) {
  const server = await adapters[target.harness]
    .serverSession?.(target)
    .catch(() => null);
  if (!server?.parent?.nickname) return null;
  const { running } = await readAgents();
  const parentId = `${target.harness}:${server.parent.sessionId}`;
  const entry = running.find((each) => each.id === parentId);
  return entry ? { entry, running, subagent: server.parent.nickname } : null;
}

// With PAIR_WAKE=off, wakeRunner writes the line to stderr instead of sending
// it, as the hub writes it to its log.
async function send(target, line) {
  const { wake } = settings();
  const result = await wakeRunner(target, line, { wake, log: console.error });
  return { sent: wake, relayed: false, ...result };
}

// An adapter with reachesSubagents delivers to the subagent that
// target.subagent names. An adapter with subagentTool delivers to the parent,
// with a first line that asks the parent's agent to pass the message on with
// that tool. pair tries the subagent first and asks the parent when that
// fails.
async function sendToSubagent(entry, subagent, sender, body) {
  const adapter = adapters[entry.cli];
  if (adapter.reachesSubagents)
    try {
      return await send(
        { ...entry.target, subagent },
        `pair message from ${sender}:\n\n${body}`,
      );
    } catch (error) {
      if (!adapter.subagentTool) throw error;
    }
  requireValue(
    adapter.subagentTool,
    `pair cannot send a message to a subagent of a ${adapter.name} session.`,
  );
  const tool = await adapter.subagentTool(entry.target, subagent);
  const relay = `pair message from ${sender}, for your subagent ${subagent}. Pass the message below to ${subagent} unchanged with ${tool}, and do not act on it yourself:`;
  return {
    ...(await send(entry.target, `${relay}\n\n${body}`)),
    relayed: true,
  };
}

function sentText(entry, subagent, delivery) {
  const session = `${entry.name} (${adapters[entry.cli].name})`;
  if (!delivery.sent)
    return `PAIR_WAKE is off, so pair wrote the message to stderr instead of sending it to ${session}.`;
  const when = `at once if it is idle, and otherwise ${delivery.steerable ? "between the steps of its current turn" : "when its current turn ends"}`;
  if (!subagent) return `Sent to ${session}. It reads the message ${when}.`;
  if (delivery.relayed)
    return `Sent to ${session}, to pass on to its subagent ${subagent}. ${entry.name} reads the message ${when}.`;
  return `Sent to ${subagent}, a subagent of ${session}. It reads the message ${when}.`;
}

export async function message(options) {
  requireNode();
  const text = await messageText(options);
  const { session, subagent } = receiver(options.to);
  const label =
    options.from === undefined ? undefined : senderLabel(options.from);
  const sender = await identifySender(label);
  const entry = findAgent(sender.running, session);
  requireValue(
    entry,
    `No running agent session is named ${session} or has an ID that starts with it. Run pair agents to list the running sessions. A session is listed after it runs pair register, pair start or pair message, or after a start hook in its CLI runs pair register --hook.`,
  );
  const body = sender.answer
    ? `${text}\n\nTo answer, run: pair message --to ${sender.answer} --text "…"`
    : text;
  const delivery = subagent
    ? await sendToSubagent(entry, subagent, sender.name, body)
    : await send(entry.target, `pair message from ${sender.name}:\n\n${body}`);
  return {
    data: sentText(entry, subagent, delivery),
    json: {
      sent: delivery.sent,
      to: entry.id,
      name: entry.name,
      cli: entry.cli,
      subagent,
      relayed: delivery.relayed,
      via: delivery.via ?? null,
      steerable: delivery.steerable ?? null,
    },
  };
}
