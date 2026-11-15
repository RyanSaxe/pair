import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

// pair reads processes with ps on macOS and Linux, and with PowerShell on
// Windows, whose ps (Git for Windows') takes no -o. Each platform gives the two
// functions below. A start time is a string that stays the same for as long as
// the process runs.

// When pair cannot run ps or PowerShell, as in Codex's sandbox, which refuses
// ps with EPERM, it cannot tell which processes run, so it fails rather than
// take every process for stopped.
const unreadable = (error, purpose) =>
  new Error(`pair could not read ${purpose}: ${error.message}`);

// psAncestors walks the parent chain with ps. Git for Windows' ps takes no -o,
// so on Windows it returns no process.
export function psAncestors(pid = process.ppid) {
  const chain = [];
  for (let current = pid; current > 1;) {
    let line;
    try {
      // ps prints its own error when it fails, so psAncestors discards its
      // stderr to keep the error out of the command's output.
      line = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(current)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch (error) {
      if (error.code === "EPERM")
        throw unreadable(error, "the parent processes of this command");
      break;
    }
    const match = /^(\d+)\s+(.*)$/.exec(line);
    if (!match) break;
    chain.push({ pid: current, command: path.basename(match[2].trim()) });
    current = Number(match[1]);
  }
  return chain;
}

const posix = {
  ancestors: psAncestors,
  // ps prints lstart in the time zone and locale of its environment, and a
  // CLI's hook and its agent's commands can run with different ones, so
  // processStarts runs ps in UTC and the C locale. macOS's ps prints nothing
  // for a list with one process ID it refuses, such as one above its largest,
  // so processStarts asks for one process at a time.
  processStarts(pids) {
    const starts = new Map();
    for (const pid of pids) {
      const { stdout, error } = spawnSync(
        "ps",
        ["-o", "lstart=", "-p", String(pid)],
        {
          encoding: "utf8",
          env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      if (error) throw unreadable(error, "which agent sessions run");
      const start = (stdout || "").trim();
      if (start) starts.set(pid, start);
    }
    return starts;
  },
  commandLine(pid) {
    try {
      return execFileSync("ps", ["-o", "args=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  },
};

// windowsProcesses lists each process that the WQL filter selects, or every
// process without one, as { pid, parent, name, start, args }, with start in
// UTC and args the process's command line.
// PowerShell gets the script base64-encoded, so no character in it needs
// quoting on the command line. It throws when PowerShell fails.
function windowsProcesses(filter) {
  const script = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$rows = @(Get-CimInstance Win32_Process ${filter ? `-Filter '${filter}'` : ""} | ForEach-Object {
  $start = $null
  if ($_.CreationDate) {
    $start = $_.CreationDate.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
  }
  [pscustomobject]@{ pid = $_.ProcessId; parent = $_.ParentProcessId; name = $_.Name; start = $start; args = $_.CommandLine }
})
ConvertTo-Json -InputObject $rows -Compress
`;
  const stdout = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
      windowsHide: true,
    },
  );
  return JSON.parse(stdout);
}

const windows = {
  // Windows keeps a process's parent ID after the parent exits, and a new
  // process can get that ID, so ancestors stops at a parent that started
  // after its child. It returns no process when PowerShell fails.
  ancestors(pid) {
    let rows;
    try {
      rows = windowsProcesses();
    } catch {
      return [];
    }
    const table = new Map(rows.map((row) => [row.pid, row]));
    const chain = [];
    for (let row = table.get(pid); row && chain.length < 64;) {
      chain.push({
        pid: row.pid,
        command: row.name.replace(/\.exe$/i, ""),
        start: row.start,
      });
      const parent = table.get(row.parent);
      if (!parent?.start || !row.start || parent.start > row.start) break;
      row = parent;
    }
    return chain;
  },
  processStarts(pids) {
    const filter = pids.map((pid) => `ProcessId=${pid}`).join(" OR ");
    let rows;
    try {
      rows = windowsProcesses(filter);
    } catch (error) {
      throw unreadable(error, "which agent sessions run");
    }
    return new Map(
      rows.filter((row) => row.start).map((row) => [row.pid, row.start]),
    );
  },
  commandLine(pid) {
    try {
      return windowsProcesses(`ProcessId=${pid}`)[0]?.args ?? null;
    } catch {
      return null;
    }
  },
};

const platform = process.platform === "win32" ? windows : posix;

// commandLine returns the command line of the process pid, or null when pair
// cannot read it. Windows quotes each argument that has a space, and ps
// quotes none.
export function commandLine(pid) {
  return Number.isInteger(pid) && pid > 0 ? platform.commandLine(pid) : null;
}

// ancestors returns pid and each process above it, nearest first, with the
// base name of its executable, without .exe on Windows. On Windows each
// process also has its start time, which the walk has already read.
export const ancestors = (pid = process.ppid) => platform.ancestors(pid);

// processStarts returns the start time of each process in pids that is
// running. Windows's filter is built from the IDs, so it takes only positive
// integers.
export function processStarts(pids) {
  const unique = [...new Set(pids)].filter(
    (pid) => Number.isInteger(pid) && pid > 0,
  );
  return unique.length ? platform.processStarts(unique) : new Map();
}
