import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// codexInvocation returns the file and the arguments that run `codex ARG…`
// with no shell, because a shell would parse the text of a message. npm
// installs Codex on Windows as codex.cmd, a batch file that runs the package's
// bin/codex.js with Node, and Node runs a batch file only through a shell. On
// Windows, codexInvocation therefore searches PATH as cmd.exe does, and returns
// a codex.exe it finds, or the script that npm's codex.cmd runs, with the Node
// that runs pair.
export function codexInvocation(args) {
  if (process.platform !== "win32") return ["codex", args];
  const directories = (process.env.PATH ?? "").split(path.delimiter);
  for (const directory of directories.filter(Boolean)) {
    const native = path.join(directory, "codex.exe");
    if (existsSync(native)) return [native, args];
    let shim;
    try {
      shim = readFileSync(path.join(directory, "codex.cmd"), "utf8");
    } catch {
      continue;
    }
    // npm's codex.cmd runs "%dp0%\SCRIPT" %*, and pnpm's runs "%~dp0\SCRIPT"
    // %*. Both name the directory of codex.cmd.
    const script = /"%~?dp0%?\\([^"]+)" %\*/.exec(shim)?.[1];
    if (script)
      return [process.execPath, [path.join(directory, script), ...args]];
  }
  return ["codex", args];
}
