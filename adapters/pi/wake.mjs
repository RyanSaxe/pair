import { fileURLToPath } from "node:url";
import { send } from "../listener.mjs";

const extension = fileURLToPath(new URL("extension.js", import.meta.url));

export const name = "pi";

// pair's extension gives the commands pi runs the session's wake socket and
// its session ID.
export const command = "pi";
export const variables = ["PAIR_PI_SOCKET", "PAIR_PI_SESSION"];
export const unwakeable = `this pi session runs without pair's extension, so it cannot be woken. Run \`pi install ${extension}\`, restart pi with \`pi --continue\`, and run \`pair start\` again.`;

// The socket changes when pi restarts, and the session ID does not.
export const identity = (target) => target.session;

export const detect = (env) => ({
  harness: "pi",
  socket: env.PAIR_PI_SOCKET,
  session: env.PAIR_PI_SESSION,
});

export const wake = (target, line) => send(target.socket, { text: line });
