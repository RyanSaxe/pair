import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

// pair reads processes with ps on macOS and Linux, and with PowerShell on
// Windows, whose ps (Git for Windows') takes no -o. Each platform gives the two
// functions below, and every start time is a UTC string such as
// 2026-11-14T19:17:14.000Z, so that one read of a process's start time matches
// another.

const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
// lstart in the C locale prints a time such as "Sat Nov  4 19:17:14 2026".
function fromLstart(text) {
  const match = /^\w{3} (\w{3}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4})$/.exec(
    text,
  );
  const month = match ? months.indexOf(match[1]) : -1;
  if (month < 0) return null;
  const [day, hour, minute, second, year] = match.slice(2).map(Number);
  return new Date(
    Date.UTC(year, month, day, hour, minute, second),
  ).toISOString();
}

const posix = {
  ancestors(pid) {
    const chain = [];
    for (let current = pid; current > 1;) {
      let line;
      try {
        // ps prints its own error when it fails, so ancestors discards its
        // stderr to keep the error out of the command's output.
        line = execFileSync(
          "ps",
          ["-o", "ppid=,comm=", "-p", String(current)],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          },
        ).trim();
      } catch {
        break;
      }
      const match = /^(\d+)\s+(.*)$/.exec(line);
      if (!match) break;
      chain.push({ pid: current, command: path.basename(match[2].trim()) });
      current = Number(match[1]);
    }
    return chain;
  },
  // ps prints a start time in the time zone and locale of its environment,
  // and a CLI's hook and its agent's commands can run with different ones, so
  // processStarts runs ps in UTC and the C locale. macOS's ps prints nothing
  // for a list that has one process ID it refuses, such as one above its
  // largest, so processStarts asks for one process at a time.
  processStarts(pids) {
    const starts = new Map();
    for (const pid of pids) {
      const { stdout } = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf8",
        env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
        stdio: ["ignore", "pipe", "ignore"],
      });
      const start = fromLstart((stdout || "").trim());
      if (start) starts.set(pid, start);
    }
    return starts;
  },
};

// windowsProcesses lists each process that the WQL filter selects, or every
// process without one, as { pid, parent, name, start }. PowerShell gets the
// script base64-encoded, so no character in it needs quoting on the command
// line. It returns no process when PowerShell fails.
function windowsProcesses(filter) {
  const script = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$rows = @(Get-CimInstance Win32_Process ${filter ? `-Filter '${filter}'` : ""} | ForEach-Object {
  $start = $null
  if ($_.CreationDate) {
    $start = $_.CreationDate.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
  }
  [pscustomobject]@{ pid = $_.ProcessId; parent = $_.ParentProcessId; name = $_.Name; start = $start }
})
ConvertTo-Json -InputObject $rows -Compress
`;
  try {
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
  } catch {
    return [];
  }
}

const windows = {
  // Windows keeps a process's parent ID after the parent exits, and a new
  // process can get that ID, so ancestors stops at a parent that started
  // after its child.
  ancestors(pid) {
    const table = new Map(windowsProcesses().map((row) => [row.pid, row]));
    const chain = [];
    for (let row = table.get(pid); row && chain.length < 64;) {
      chain.push({ pid: row.pid, command: row.name.replace(/\.exe$/i, "") });
      const parent = table.get(row.parent);
      if (!parent?.start || !row.start || parent.start > row.start) break;
      row = parent;
    }
    return chain;
  },
  processStarts(pids) {
    const filter = pids.map((pid) => `ProcessId=${pid}`).join(" OR ");
    return new Map(
      windowsProcesses(filter)
        .filter((row) => row.start)
        .map((row) => [row.pid, row.start]),
    );
  },
};

const platform = process.platform === "win32" ? windows : posix;

// ancestors returns pid and each process above it, nearest first, with the
// base name of its executable, without .exe on Windows.
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
