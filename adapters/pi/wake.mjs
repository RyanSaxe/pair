import { fileURLToPath } from "node:url";
import { send } from "../listener.mjs";

const extension = fileURLToPath(new URL("extension.js", import.meta.url));

export const name = "pi";

// pair's extension gives the commands pi runs the session's wake socket and
// its session ID.
export const command = "pi";
export const variables = ["PAIR_PI_SOCKET", "PAIR_PI_SESSION"];
export const unwakeable = `Ask the user to run \`pi install ${extension}\` and restart pi with \`pi --continue\`, then run \`pair start\` again. This pi session runs without pair's extension, so the hub cannot wake it.`;

// The socket changes when pi restarts, and the session ID does not.
export const identity = (target) => target.session;

export const detect = (env) => ({
  harness: "pi",
  socket: env.PAIR_PI_SOCKET,
  session: env.PAIR_PI_SESSION,
});

// The extension gives pi the line as a steering message, and pi adds it to
// the turn in progress between its steps.
export async function wake(target, line) {
  await send(target.socket, { text: line });
  return { via: "steer", steerable: true };
}
