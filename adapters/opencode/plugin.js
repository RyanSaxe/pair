import { listen } from "../listener.mjs";

// opencode loads this file as a plugin and calls every export as one, so the
// file exports nothing else. The plugin gives every shell command its wake
// socket and the ID of the session that runs the command.
//
// opencode adds a prompt sent to a busy session to the running request after
// its current tool call, so the plugin holds wake lines for a session until
// its session.status event says idle. The running request finishes first, as
// it does in pi.
export const PairWake = async ({ client }) => {
  const busy = new Set();
  const waiting = new Map();
  const deliver = async (session, lines) => {
    const { error } = await client.session.promptAsync({
      path: { id: session },
      body: { parts: lines.map((text) => ({ type: "text", text })) },
    });
    if (error)
      throw new Error(`opencode refused the prompt: ${JSON.stringify(error)}`);
  };
  const listener = listen(async ({ session, text }) => {
    if (!busy.has(session)) return deliver(session, [text]);
    waiting.set(session, [...(waiting.get(session) ?? []), text]);
  });
  return {
    event: async ({ event }) => {
      if (event.type !== "session.status") return;
      const { sessionID, status } = event.properties;
      if (status.type !== "idle") return void busy.add(sessionID);
      busy.delete(sessionID);
      const lines = waiting.get(sessionID);
      if (!lines) return;
      waiting.delete(sessionID);
      // The hub already recorded these lines as delivered, so a refusal here
      // has no one to answer.
      await deliver(sessionID, lines).catch(() => {});
    },
    "shell.env": async ({ sessionID }, output) => {
      output.env.PAIR_OPENCODE_SOCKET = listener.socket;
      if (sessionID) output.env.PAIR_OPENCODE_SESSION = sessionID;
    },
    dispose: async () => listener.close(),
  };
};
