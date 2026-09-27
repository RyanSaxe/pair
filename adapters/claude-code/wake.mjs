import net from "node:net";

// Claude Code gives the commands it runs an inbox socket and its token.
export function detect(env, { ancestor }) {
  if (
    ancestor ? ancestor.command !== "claude" : !env.CLAUDE_CODE_MESSAGING_SOCKET
  )
    return null;
  const socket = env.CLAUDE_CODE_MESSAGING_SOCKET;
  const token = env.CLAUDE_CODE_MESSAGING_TOKEN;
  if (!socket || !token)
    throw new Error(
      "this Claude Code session exposes no inbox socket, so it cannot be woken.",
    );
  return { harness: "claude-code", socket, token };
}

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
