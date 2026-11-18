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
    const tools = { ancestors: () => ancestors(table) };
    const target = detectAgent(process.env, tools);
    if (!target) return { name: "your user", answer: null };
    const { entry, subagent, running } = await registerAgent(target, {
      table,
      sender: true,
    });
    const address = subagent ? `${entry.id}/${subagent}` : entry.id;
    const name = subagent ? `${entry.name}/${subagent}` : entry.name;
    const where = `${adapters[entry.cli].name} in ${shortPath(entry.directory)}`;
    return { name: `${name} (${where})`, answer: address, running };
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

// A message goes to the session itself, to the subagent that target.subagent
// names when the adapter's subagentTool returns null, as opencode's plugin
// delivers it, or to the parent, with a first line that asks the parent's
// agent to pass it on with the tool that subagentTool names.
async function route(entry, subagent) {
  if (!subagent) return { way: "direct", target: entry.target };
  const adapter = adapters[entry.cli];
  requireValue(
    adapter.subagentTool,
    `pair cannot send a message to a subagent of a ${adapter.name} session.`,
  );
  const tool = await adapter.subagentTool(entry.target, subagent);
  return tool === null
    ? { way: "subagent", target: { ...entry.target, subagent } }
    : { way: "relayed", target: entry.target, tool };
}

function sentText(entry, subagent, way, { steerable }) {
  const session = `${entry.name} (${adapters[entry.cli].name})`;
  const when = `at once if it is idle, and otherwise ${steerable ? "between the steps of its current turn" : "when its current turn ends"}`;
  return {
    direct: `Sent to ${session}. It reads the message ${when}.`,
    subagent: `Sent to ${subagent}, a subagent of ${session}. It reads the message ${when}.`,
    relayed: `Sent to ${session}, to pass on to its subagent ${subagent}. ${entry.name} reads the message ${when}.`,
  }[way];
}

export async function message(options) {
  requireNode();
  const text = await messageText(options);
  const { session, subagent } = receiver(options.to);
  const label = options.from?.trim();
  if (options.from !== undefined && (!label || /[\r\n]/.test(label)))
    throw usageError("message", "--from takes a label of one line.");
  const table = processTable();
  const sender = await identifySender(label, table);
  requireValue(
    !options.ack || sender.answer,
    "pair message --ack works only inside an agent session, because it names that session as the one that read the message.",
  );
  const entry = findAgent(sender.running ?? (await readAgents(table)), session);
  requireValue(
    entry,
    `No running agent session is named ${session} or has an ID that starts with it. Run pair agents to list the running sessions. A session is listed after it runs pair register, pair start, pair message or pair spawn, or after a start hook in its CLI runs pair register --hook.`,
  );
  const { way, target, tool } = await route(entry, subagent);
  const from = `pair message from ${sender.name}`;
  const body = options.ack
    ? `${from} acknowledges your message. Don't answer it.`
    : `${text}\n\n${ending(sender.answer)}`;
  const line =
    way === "relayed"
      ? `${from}, for your subagent ${subagent}. Pass the message below to ${subagent} unchanged with ${tool}, and do not act on it yourself:\n\n${body}`
      : options.ack
        ? body
        : `${from}:\n\n${body}`;
  // With PAIR_WAKE=off, wakeRunner writes the line to stderr instead of
  // sending it, as the hub writes it to its log.
  const { wake } = settings();
  const delivery = await wakeRunner(target, line, { wake, log: console.error });
  return {
    data: wake
      ? sentText(entry, subagent, way, delivery)
      : `PAIR_WAKE is off, so pair wrote the message to stderr instead of sending it to ${entry.name} (${adapters[entry.cli].name}).`,
  };
}
