import { listen } from "../listener.mjs";
import { register } from "../register.mjs";
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
  const variables = (sessionID) => ({
    PAIR_OPENCODE_SOCKET: listener.socket,
    PAIR_OPENCODE_PID: String(process.pid),
    ...(sessionID && { PAIR_OPENCODE_SESSION: sessionID }),
  });
  return {
    "shell.env": async ({ sessionID }, output) => {
      Object.assign(output.env, variables(sessionID));
    },
    // A subagent's session has a parentID, and pair reaches it through the
    // session that started it, so the plugin registers only the others.
    event: async ({ event }) => {
      if (event.type !== "session.created") return;
      const { id, directory, parentID } = event.properties.info;
      if (!parentID) register(directory, variables(id));
    },
    dispose: async () => listener.close(),
  };
};
