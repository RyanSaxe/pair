import fs from "node:fs";
import path from "node:path";
import { windowsDir } from "./windows.mjs";

// opencode 2 loads this file in each of its windows, and server.js in its
// background server, which keeps running after every window exits. The file
// that this plugin keeps says which sessions the window has open, so pair
// counts an opencode 2 session as running only while a window has it open.
// opencode gives a plugin no event when a tab opens or closes, so the plugin
// checks the tabs twice a second.
export default {
  id: "pair.tui",
  setup(context) {
    const file = path.join(windowsDir(), `${process.pid}.json`);
    let written = null;
    const write = () => {
      const sessions = new Set(
        context.ui.tabs.enabled()
          ? context.ui.tabs.list().map(({ sessionID }) => sessionID)
          : [],
      );
      const route = context.ui.router.current();
      if (route?.type === "session") sessions.add(route.sessionID);
      const text = JSON.stringify({ sessions: [...sessions] });
      if (text === written) return;
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(`${file}.tmp`, text);
      fs.renameSync(`${file}.tmp`, file);
      written = text;
    };
    write();
    const timer = setInterval(write, 500);
    return () => {
      clearInterval(timer);
      fs.rmSync(file, { force: true });
    };
  },
};
