import net from "node:net";

export const name = "Claude Code";

// Claude Code sets an inbox socket and its token in the environment of each
// command it runs.
export const command = "claude";
export const variables = [
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
];
export const unwakeable =
  "Tell the user that this Claude Code session exposes no inbox socket, so the hub cannot wake it, and stop.";

// A Claude Code session has one inbox socket, and its subagents share it.
export const identity = (target) => target.socket;

// The session ID stays the same when the session resumes, and the inbox socket
// does not.
export const sessionId = (target) => target.session;

// A Claude Code subagent has no inbox of its own, so pair message asks the
// parent's agent to pass a message on with its SendMessage tool, which takes
// the subagent's name.
export const subagentTool = () => "SendMessage";

// launch returns the command line that starts a new session with a prompt,
// and with name, the name that Claude Code shows for the session. args are
// the caller's own flags for Claude Code. The -- before the prompt ends the
// options, so a flag that takes several values, such as --add-dir, does not
// take the prompt as one of them.
export const launch = ({ name, prompt, args = [] }) => [
  command,
  ...(name ? ["--name", name] : []),
  ...args,
  "--",
  prompt,
];

// The hub wakes a Claude Code session with its socket and token alone, so
// detect leaves the session out when CLAUDE_CODE_SESSION_ID is not set.
export const detect = (env) => ({
  harness: "claude-code",
  socket: env.CLAUDE_CODE_MESSAGING_SOCKET,
  token: env.CLAUDE_CODE_MESSAGING_TOKEN,
  ...(env.CLAUDE_CODE_SESSION_ID && { session: env.CLAUDE_CODE_SESSION_ID }),
});

// Claude Code reads its inbox between the steps of a turn, so a wake reaches a
// turn in progress.
export function wake({ socket, token }, line) {
  return new Promise((resolve, reject) => {
    const client = net.connect(socket);
    client.setTimeout(5000, () => client.destroy(new Error("timed out")));
    client.on("error", reject);
    client.on("close", () => resolve({ via: "inbox", steerable: true }));
    client.end(
      JSON.stringify({ type: "auth", token }) +
        "\n" +
        JSON.stringify({
          type: "user",
          message: { role: "user", content: line },
        }) +
        "\n",
    );
  });
}
