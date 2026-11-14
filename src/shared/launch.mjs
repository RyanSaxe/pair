import { execFile } from "node:child_process";

// An agent CLI's interactive session needs a terminal, which pair cannot open
// itself, so pair hands the CLI's command line to a launch script that the
// user writes for their terminal. Windows runs a script only through its
// interpreter, so there the script is spawn.ps1, which runLaunch runs with
// Windows PowerShell. -File hands each argument to the script unchanged, and
// no cmd.exe parses them.
const invocation = (script, args) =>
  process.platform === "win32"
    ? [
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          ...args,
        ],
      ]
    : [script, args];

// runLaunch runs `script DIR COMMAND ARG…` in DIR with no shell, so no
// character in the prompt changes the command. It resolves when the script
// exits with status 0, and rejects with the script's error output otherwise.
export function runLaunch(script, directory, command) {
  const [file, args] = invocation(script, [directory, ...command]);
  return new Promise((resolve, reject) =>
    execFile(
      file,
      args,
      { cwd: directory, timeout: 10_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) return resolve();
        const said = stderr.trim();
        reject(
          new Error(
            error.killed
              ? `The launch script ${script} did not exit within 10 seconds. It must open the command in a new terminal and exit.`
              : typeof error.code === "number"
                ? `The launch script ${script} exited with status ${error.code}${said ? `: ${said}` : "."}`
                : `pair could not run the launch script ${script}: ${error.message}`,
          ),
        );
      },
    ),
  );
}
