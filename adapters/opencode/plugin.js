import { listen } from "../listener.mjs";

// The task tool titles the session of each subagent it starts "DESCRIPTION
// (@AGENT subagent)". subagentSession returns the newest child session of
// session whose description or agent is name.
async function subagentSession(client, session, name) {
  const { data, error } = await client.session.children({
    path: { id: session },
  });
  if (error)
    throw new Error(
      `opencode did not list the subagents: ${JSON.stringify(error)}`,
    );
  const wanted = name.toLowerCase();
  const named = data.filter(({ title }) => {
    const [, description, agent] =
      /^(.*) \(@(.+) subagent\)$/.exec(title) ?? [];
    return [title, description, agent].some(
      (each) => each?.toLowerCase() === wanted,
    );
  });
  if (!named.length)
    throw new Error(
      `The opencode session has no subagent named ${name}. ${data.length ? `Its subagents are ${data.map(({ title }) => title).join(", ")}.` : "It has no subagents."}`,
    );
  return named.reduce((newest, child) =>
    child.time.created > newest.time.created ? child : newest,
  );
}

// opencode loads this file as a plugin and calls every export as a plugin, so
// the file exports nothing else.
//
// opencode adds a prompt for a busy session to the running request, and the
// model reads it after the tool calls of the current step. For an idle session,
// opencode starts a request with the prompt. A prompt with no agent runs under
// the default agent, so a prompt to a subagent's session names its agent.
export const PairWake = async ({ client }) => {
  const listener = listen(async ({ session, text, subagent }) => {
    const child = subagent
      ? await subagentSession(client, session, subagent)
      : null;
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
