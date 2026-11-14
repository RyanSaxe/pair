import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";

// An agent CLI's interactive session needs a terminal, and pair cannot open
// one itself, so pair hands the CLI's command line to a launch script that the
// user writes for their own terminal. The script receives the folder and each
// part of the command as a separate argument, and must start the command in a
// new terminal and exit.
const timeoutMs = 10_000;

// launchProblem returns why pair cannot run the script, or null when it can.
export function launchProblem(script) {
  let stat;
  try {
    stat = statSync(script);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code))
      return `No launch script at ${script}.`;
    throw error;
  }
  if (!stat.isFile())
    return `${script} is not a file, so pair cannot run it as the launch script.`;
  try {
    accessSync(script, constants.X_OK);
  } catch {
    return `The launch script ${script} is not executable. Run chmod +x ${script}.`;
  }
  return null;
}

function folderProblem(directory) {
  try {
    if (statSync(directory).isDirectory()) return null;
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
  }
  return `${directory} is not a folder, so pair cannot start an agent in it.`;
}

// runLaunch runs `script DIR COMMAND ARG…` with no shell, so no character in
// the prompt changes the command. It resolves when the script exits with
// status 0, and rejects with the script's error output otherwise.
export function runLaunch(script, directory, command) {
  const problem = launchProblem(script) || folderProblem(directory);
  if (problem) return Promise.reject(new Error(problem));
  return new Promise((resolve, reject) => {
    const child = spawn(script, [directory, ...command], {
      cwd: directory,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let output = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on(
      "data",
      (chunk) => (output = (output + chunk).slice(-2000)),
    );
    // A terminal the script starts can keep the script's error output open
    // after the script exits, so runLaunch waits for the exit and not for the
    // output to close, and gives a failed script's last output 200 ms to
    // arrive.
    const ended = new Promise((done) => {
      child.stderr.on("end", done);
      child.stderr.on("error", done);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `The launch script ${script} did not exit within ${timeoutMs / 1000} seconds. It must start the command in a new terminal and exit.`,
        ),
      );
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `pair could not run the launch script ${script}: ${error.message}`,
        ),
      );
    });
    child.on("exit", async (code, signal) => {
      clearTimeout(timer);
      if (code !== 0)
        await Promise.race([
          ended,
          new Promise((done) => setTimeout(done, 200)),
        ]);
      child.stderr.destroy();
      if (code === 0) return resolve();
      const said = output.trim();
      reject(
        new Error(
          signal
            ? `The launch script ${script} stopped on ${signal}.`
            : `The launch script ${script} exited with status ${code}${said ? `: ${said}` : "."}`,
        ),
      );
    });
  });
}
