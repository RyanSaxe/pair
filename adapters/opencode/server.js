import { listen } from "../listener.mjs";
import { register } from "../register.mjs";

// subagentSession returns the newest child session of session whose title or
// agent is name. opencode 2's task tool titles a subagent's session with its
// task.
async function subagentSession(ctx, session, name) {
  const { data } = await ctx.session.list({ parentID: session });
  const wanted = name.toLowerCase();
  const named = data.filter(({ title, agent }) =>
    [title, agent].some((each) => each?.toLowerCase() === wanted),
  );
  if (!named.length)
    throw new Error(
      `The opencode session has no subagent named ${name}. ${data.length ? `Its subagents are ${data.map(({ title }) => title).join(", ")}.` : "It has no subagents."}`,
    );
  return named.reduce((newest, child) =>
    child.time.created > newest.time.created ? child : newest,
  );
}

// opencode 2 loads this file when its config lists this folder, and runs it
// in opencode's background server, which serves the sessions of every opencode
// started with the same config and keeps running after they exit. opencode 1
// loads plugin.js instead.
//
// opencode adds a prompt for a busy session to the running request at its
// next step. For an idle session, opencode starts a request with the prompt.
export default {
  id: "pair",
  async setup(ctx) {
    const listener = listen(async ({ session, text, subagent }) => {
      const sessionID = subagent
        ? (await subagentSession(ctx, session, subagent)).id
        : session;
      await ctx.session.prompt({ sessionID, text });
    });
    // opencode sets OPENCODE_SESSION_ID for each shell command after this
    // hook runs, and pair reads the session's ID from it.
    await ctx.shell.hook("create.before", (event) => {
      event.env.PAIR_OPENCODE_SOCKET = listener.socket;
      event.env.PAIR_OPENCODE_PID = String(process.pid);
    });
    // A subagent's session has a parentID, and pair reaches it through the
    // session that started it, so the plugin registers only the others.
    const controller = new AbortController();
    (async () => {
      for await (const { data } of ctx.event.subscribe({
        types: ["session.created"],
        signal: controller.signal,
      }))
        if (!data.parentID)
          register(data.location.directory, {
            PAIR_OPENCODE_SOCKET: listener.socket,
            PAIR_OPENCODE_SESSION: data.sessionID,
            PAIR_OPENCODE_PID: String(process.pid),
          });
      // Aborting the subscription when the plugin unloads ends the loop with
      // an error, and a session the plugin misses registers at its first pair
      // command.
    })().catch(() => {});
    return () => {
      controller.abort();
      listener.close();
    };
  },
};
