import { listen } from "../listener.mjs";

// pi loads this file as an extension. Each pi session opens a wake socket and
// gives it, with the session ID, to every command pi runs.
export default function pair(pi) {
  let listener = null;
  pi.on("session_start", (_event, ctx) => {
    // While pi runs a turn, it adds a steering message to the turn after the
    // tool calls of the current model response. When pi is idle, the message
    // starts a turn.
    listener = listen(({ text }) =>
      pi.sendUserMessage(text, { deliverAs: "steer" }),
    );
    process.env.PAIR_PI_SOCKET = listener.socket;
    process.env.PAIR_PI_SESSION = ctx.sessionManager.getSessionId();
  });
  pi.on("session_shutdown", () => {
    listener?.close();
    delete process.env.PAIR_PI_SOCKET;
    delete process.env.PAIR_PI_SESSION;
  });
}
