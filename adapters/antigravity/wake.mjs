import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commandLine } from "../../src/shared/processes.mjs";

const exec = promisify(execFile);

const nonInteractive =
  /(?:^|\s)(?:-p(?:=|\s|$)|--print(?:=|\s|$)|--prompt(?:=|\s|$)|--input-format(?:=|\s|$)|acp(?:\s|$)|agentapi(?:\s|$))/;

export const name = "Antigravity CLI";

// agy gives each command that its agent runs the session's conversation ID,
// the address and CSRF token of agy's language server, and the path of agy
// itself, which runs agentapi. It gives a hook only the conversation ID.
export const command = "agy";
export const variables = [
  "ANTIGRAVITY_CONVERSATION_ID",
  "ANTIGRAVITY_LS_ADDRESS",
  "ANTIGRAVITY_CSRF_TOKEN",
  "ANTIGRAVITY_AGENTAPI_EXE",
];
export const unwakeable =
  "Tell the user that this Antigravity CLI session gave the command no ANTIGRAVITY_LS_ADDRESS, ANTIGRAVITY_CSRF_TOKEN or ANTIGRAVITY_AGENTAPI_EXE, so the hub cannot wake it, and stop.";

// The language server's address and token change when agy restarts, and the
// conversation ID does not.
export const identity = (target) => target.conversation;

// launch returns the command line that starts a new session with a prompt.
// agy takes the prompt as the value of -i, so no flag in args can take it, and
// agy has no flag that names a session.
export const launch = ({ prompt, args = [] }) => [
  command,
  ...args,
  "-i",
  prompt,
];

export const detect = (env) => ({
  harness: "antigravity",
  conversation: env.ANTIGRAVITY_CONVERSATION_ID,
  address: env.ANTIGRAVITY_LS_ADDRESS,
  token: env.ANTIGRAVITY_CSRF_TOKEN,
  agentapi: env.ANTIGRAVITY_AGENTAPI_EXE,
});

// An agy subagent shares its parent's agy process with a conversation ID of
// its own, so without parentSession it would register as a session of its own
// and replace its parent's entry. agentapi get-conversation-metadata returns
// parentConversationId on a subagent, rootConversationId for the top-level
// session listed in pair agents, and subagentSpec.role for the subagent's
// role.
export async function parentSession(target) {
  const { stdout } = await exec(
    target.agentapi,
    ["agentapi", "get-conversation-metadata", target.conversation],
    {
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        ANTIGRAVITY_LS_ADDRESS: target.address,
        ANTIGRAVITY_CSRF_TOKEN: target.token,
      },
    },
  );
  const metadata = JSON.parse(stdout)?.response?.conversationMetadata?.metadata;
  if (!metadata?.parentConversationId) return null;
  const role = metadata.subagentSpec?.role?.trim();
  return {
    sessionId: metadata.rootConversationId || metadata.parentConversationId,
    ...(role && { nickname: role }),
  };
}

// pair message asks the parent's agent to pass a message on to its subagent
// with send_message, Antigravity CLI's tool for messaging a subagent.
export const subagentTool = () => "send_message";

// agy leaves ANTIGRAVITY_LS_ADDRESS, ANTIGRAVITY_CSRF_TOKEN and
// ANTIGRAVITY_AGENTAPI_EXE out of a hook's environment, so a PreInvocation
// hook cannot register a wakeable session itself. Instead, pair register
// --hook checks whether this interactive agy process is already listed and,
// when it is not, returns an ephemeralMessage asking the agent to run pair
// register alongside its first action. Once registered, later turns and
// subagents share the same agy process and print nothing; an `agy -c` restart
// starts a new agy process and re-registers on its next turn.
export function hookResponse(ancestor, { running, env, input, name }) {
  if (nonInteractive.test(commandLine(ancestor) ?? "")) return null;
  if (variables.every((key) => env[key])) return undefined;
  const registered = running.some(
    (entry) =>
      entry.cli === "antigravity" &&
      entry.pid === ancestor.pid &&
      entry.processStart === ancestor.start,
  );
  if (registered) return null;
  if (/\bpair register\b/.test(input?.lastUserInput ?? "")) return null;
  const command = name ? `pair register --name ${name}` : "pair register";
  return {
    injectSteps: [
      {
        ephemeralMessage: `Run \`${command}\` in your own shell outside the sandbox alongside your first action so other agents can reach this session. Do not mention it unless it fails.`,
      },
    ],
  };
}

// agentapi prints its error as JSON, such as {"error": "…"}.
function agentapiError(output) {
  try {
    return JSON.parse(output).error || output;
  } catch {
    return output;
  }
}

// agentapi send-message gives the conversation the line as a message. While a
// turn runs, agy adds it to the turn after the tool call in progress, and an
// idle agy starts a turn with it.
export async function wake(target, line, run) {
  const args = ["agentapi", "send-message", target.conversation, line];
  const env = {
    ANTIGRAVITY_LS_ADDRESS: target.address,
    ANTIGRAVITY_CSRF_TOKEN: target.token,
  };
  try {
    await run(target.agentapi, args, env);
  } catch (error) {
    throw new Error(agentapiError(error.message));
  }
  return { via: "send-message", steerable: true };
}
