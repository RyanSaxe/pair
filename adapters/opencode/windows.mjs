import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// pair's TUI plugin, tui.js, runs in each opencode 2 window and keeps a file in
// this folder, named by the window's process ID, with the sessions the window
// has open in its tabs.
export const windowsDir = (env = process.env) =>
  path.join(
    env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
    "pair",
    "opencode-windows",
  );

// A window that opencode closed without unloading the plugin leaves its file,
// so a file counts only while its process runs.
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function openInWindow(session) {
  let names;
  try {
    names = fs.readdirSync(windowsDir());
  } catch {
    return false;
  }
  return names.some((name) => {
    if (!running(Number.parseInt(name, 10))) return false;
    try {
      const file = path.join(windowsDir(), name);
      return JSON.parse(fs.readFileSync(file, "utf8")).sessions.includes(
        session,
      );
    } catch {
      return false;
    }
  });
}
