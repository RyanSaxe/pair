import { execFileSync } from "node:child_process";
import path from "node:path";

const windows = process.platform === "win32";
const quiet = {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
  maxBuffer: 64 * 1024 * 1024,
  windowsHide: true,
};

// ps prints lstart in the time zone and locale of its environment, and a CLI's
// hook and its agent's commands can run with different ones, so pair runs ps
// in UTC and the C locale. lstart is five words, such as "Sat Nov 14 19:09:41
// 2026", and a command may have spaces.
function psRows() {
  const stdout = execFileSync("ps", ["-A", "-o", "pid=,ppid=,lstart=,comm="], {
    ...quiet,
    env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
  });
  return stdout.split("\n").flatMap((line) => {
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/.exec(line);
    if (!match) return [];
    const [, pid, parent, start, command] = match;
    return [
      {
        pid: Number(pid),
        parent: Number(parent),
        start: start.replace(/\s+/g, " "),
        command: path.basename(command.trim()),
      },
    ];
  });
}

// powershell runs a PowerShell script on Windows and returns what it prints.
// PowerShell gets the script base64-encoded, so no character in it needs
// quoting.
export function powershell(script) {
  const utf8 = `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n${script}`;
  const encoded = Buffer.from(utf8, "utf16le").toString("base64");
  return execFileSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { ...quiet, timeout: 30_000 },
  );
}

// Git for Windows' ps takes no -o, so on Windows pair reads every process from
// Win32_Process, with its command line, in one PowerShell call.
function cimRows() {
  const stdout = powershell(`
$rows = @(Get-CimInstance Win32_Process | ForEach-Object {
  $start = $null
  if ($_.CreationDate) { $start = $_.CreationDate.ToUniversalTime().ToString("o") }
  [pscustomobject]@{ pid = $_.ProcessId; parent = $_.ParentProcessId; name = $_.Name; start = $start; args = $_.CommandLine }
})
ConvertTo-Json -InputObject $rows -Compress
`);
  return JSON.parse(stdout).map(({ name, ...row }) =>
    Object.assign(row, { command: name.replace(/\.exe$/i, "") }),
  );
}

// processTable returns every running process by its ID, as { pid, parent,
// start, command }, where start is a string that stays the same for as long
// as the process runs and command is the base name of its executable. When
// pair cannot run ps or PowerShell, as in Codex's sandbox, which refuses ps
// with EPERM, it cannot tell which processes run, so it throws.
export function processTable() {
  try {
    return new Map(
      (windows ? cimRows() : psRows()).map((row) => [row.pid, row]),
    );
  } catch (error) {
    throw new Error(
      `pair could not read which processes run: ${error.message}`,
      { cause: error },
    );
  }
}

// ancestors returns the process pid and each process above it in table,
// nearest first. Windows keeps a process's parent ID after the parent exits,
// and a new process can get that ID, so on Windows the walk stops at a parent
// that started after its child.
export function ancestors(table, pid = process.ppid) {
  const chain = [];
  for (let row = table.get(pid); row && row.pid > 1 && chain.length < 64;) {
    chain.push(row);
    const parent = table.get(row.parent);
    if (windows && !(parent?.start && row.start && parent.start <= row.start))
      break;
    row = parent;
  }
  return chain;
}
// commandLine returns the command line of a process in the table, or null when
// pair cannot read it. Windows' table has each command line, with each
// argument that has a space in quotes, and ps prints one with no quotes.
export function commandLine(row) {
  if (row.args !== undefined) return row.args;
  try {
    return execFileSync(
      "ps",
      ["-o", "args=", "-p", String(row.pid)],
      quiet,
    ).trim();
  } catch {
    return null;
  }
}
