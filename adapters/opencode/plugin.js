import { listen } from "../listener.mjs";
import { newestSubagent } from "./subagents.mjs";

// opencode loads this file as a plugin and calls every export as a plugin, so
// the file exports nothing else.
//
// opencode adds a prompt for a busy session to the running request, and the
// model reads it after the tool calls of the current step. For an idle session,
// opencode starts a request with the prompt. A prompt with no agent runs under
// the default agent, so a prompt to a subagent's session names its agent.
export const PairWake = async ({ client }) => {
  const listener = listen(async ({ session, text, subagent, query }) => {
    if (query === "session") {
      const { data, error } = await client.session.get({
        path: { id: session },
      });
      if (error)
        throw new Error(
          `opencode did not find the session: ${JSON.stringify(error)}`,
        );
      return { parentID: data.parentID, title: data.title };
    }
    let child = null;
    if (subagent) {
      const { data, error } = await client.session.children({
        path: { id: session },
      });
      if (error)
        throw new Error(
          `opencode did not list the subagents: ${JSON.stringify(error)}`,
        );
      child = newestSubagent(data, subagent);
    }
    const { error } = await client.session.promptAsync({
      path: { id: child?.id ?? session },
      body: {
        ...(child?.agent && { agent: child.agent }),
        parts: [{ type: "text", text }],
      },
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
