import { listen } from "../listener.mjs";

// opencode loads this file as a plugin and calls every export as a plugin, so
// the file exports nothing else.
//
// opencode adds a prompt for a busy session to the running request, and the
// model reads it after the tool calls of the current step. For an idle session,
// opencode starts a request with the prompt.
export const PairWake = async ({ client }) => {
  const listener = listen(async ({ session, text }) => {
    const { error } = await client.session.promptAsync({
      path: { id: session },
      body: { parts: [{ type: "text", text }] },
    });
    if (error)
      throw new Error(`opencode refused the prompt: ${JSON.stringify(error)}`);
  });
  return {
    "shell.env": async ({ sessionID }, output) => {
      output.env.PAIR_OPENCODE_SOCKET = listener.socket;
      if (sessionID) output.env.PAIR_OPENCODE_SESSION = sessionID;
    },
    dispose: async () => listener.close(),
  };
};
