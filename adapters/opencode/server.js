import { listen } from "../listener.mjs";
import { register } from "../register.mjs";
import { newestSubagent } from "./subagents.mjs";
import { openInWindow } from "./windows.mjs";

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
    const listener = listen(async ({ session, text, subagent, query }) => {
      if (query === "session") {
        const { parentID, title } = await ctx.session.get({
          sessionID: session,
        });
        return { parentID, title, open: openInWindow(session) };
      }
      const sessionID = subagent
        ? newestSubagent(
            (await ctx.session.list({ parentID: session })).data,
            subagent,
          ).id
        : session;
      await ctx.session.prompt({ sessionID, text });
    });
    const variables = {
      PAIR_OPENCODE_SOCKET: listener.socket,
      PAIR_OPENCODE_PID: String(process.pid),
    };
    // opencode sets OPENCODE_SESSION_ID for each shell command after this
    // hook runs, and pair reads the session's ID from it.
    await ctx.shell.hook("create.before", (event) => {
      Object.assign(event.env, variables);
    });
    // A subagent's session has a parentID, and pair reaches it through the
    // session that started it, so the plugin registers only the others.
    // Aborting the subscription when the plugin unloads ends the loop with an
    // error, and a session that the plugin misses registers at its first pair
    // command.
    const controller = new AbortController();
    (async () => {
      for await (const { data } of ctx.event.subscribe({
        types: ["session.created"],
        signal: controller.signal,
      }))
        if (!data.parentID)
          register(data.location.directory, {
            ...variables,
            PAIR_OPENCODE_SESSION: data.sessionID,
          });
    })().catch(() => {});
    return () => {
      controller.abort();
      listener.close();
    };
  },
};
