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

// endOptions ends the caller's arguments for a CLI whose prompt is a
// positional argument with --, after which the CLI reads the prompt as the
// prompt whatever flag comes before it. With no arguments, the command line
// stays as it was before pair spawn took any, for a launch script that adds a
// flag after the prompt.
export const endOptions = (args) => (args.length ? [...args, "--"] : []);

// A session that pair starts runs pair register as its first step, so pair
// agents lists it and pair message reaches it whether or not its CLI has a
// start hook. firstPrompt returns that step, with --name when name is given,
// followed by rest. An agent told to use a terminal tool can run a command in
// a new terminal, where its CLI's session variables are missing, so the step
// names its own shell. Two sessions started together with one name both run
// pair register --name, and the second must not stop to ask for another name.
export const firstPrompt = (name, rest) =>
  [
    name
      ? `In your own shell, run pair register --name ${name} first. If another running session has that name, run pair register without --name.`
      : "In your own shell, run pair register first.",
    rest,
  ]
    .filter(Boolean)
    .join(" ");
