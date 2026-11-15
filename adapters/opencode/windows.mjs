import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { processTable } from "../../src/shared/processes.mjs";

// pair's window plugin, tui.js, runs in each opencode 2 window and keeps a
// file in this folder, named for the window's process ID, with the window's
// start time and the sessions it has open.
export const windowsDir = (env = process.env) =>
  path.join(
    env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
    "pair",
    "opencode-windows",
  );

// A window that exits without unloading the plugin leaves its file, and a new
// process can get the window's ID, so a file counts only while a process with
// that ID and start time runs.
export function openInWindow(session) {
  let names;
  try {
    names = fs.readdirSync(windowsDir());
  } catch {
    return false;
  }
  const table = processTable();
  return names.some((name) => {
    try {
      const file = path.join(windowsDir(), name);
      const { start, sessions } = JSON.parse(fs.readFileSync(file, "utf8"));
      const window = table.get(Number.parseInt(name, 10));
      return window?.start === start && sessions.includes(session);
    } catch {
      return false;
    }
  });
}
