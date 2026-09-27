import net from "node:net";

export const name = "Claude Code";

// Claude Code gives the commands it runs an inbox socket and its token.
export const command = "claude";
export const variables = [
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
];
export const unwakeable =
  "this Claude Code session exposes no inbox socket, so it cannot be woken.";

// A Claude Code session has one inbox socket, and its subagents share it.
export const identity = (target) => target.socket;

export const detect = (env) => ({
  harness: "claude-code",
  socket: env.CLAUDE_CODE_MESSAGING_SOCKET,
  token: env.CLAUDE_CODE_MESSAGING_TOKEN,
});

// Two JSON lines over the socket: the auth line, then a user message.
export function wake({ socket, token }, line) {
  return new Promise((resolve, reject) => {
    const client = net.connect(socket);
    client.setTimeout(5000, () => client.destroy(new Error("timed out")));
    client.on("error", reject);
    client.on("close", resolve);
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
