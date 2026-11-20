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
