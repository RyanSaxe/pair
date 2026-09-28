import { listen } from "../listener.mjs";

// pi loads this file as an extension. Each pi session opens a wake socket and
// gives it, with the session ID, to every command pi runs.
export default function pair(pi) {
  let listener = null;
  pi.on("session_start", (_event, ctx) => {
    // followUp waits for a running turn to finish, as Codex's queue and
    // Copilot's enqueue do, and starts a turn when pi is idle.
    listener = listen(({ text }) =>
      pi.sendUserMessage(text, { deliverAs: "followUp" }),
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
