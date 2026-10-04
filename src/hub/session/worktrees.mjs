import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Git reads GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE before its working
// directory, so a hub started from a git hook or under git rebase -x would
// point git at that repository instead of the worktree.
const gitEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );

// Each directory under root with a .git file, which a linked worktree has in
// place of a .git directory. The search follows no symbolic link and does
// not enter a working tree it finds.
async function linkedWorktrees(root) {
  const found = [];
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop();
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch(() => []);
    const git = entries.find((entry) => entry.name === ".git");
    if (git) {
      if (git.isFile()) found.push(directory);
      continue;
    }
    for (const entry of entries)
      if (entry.isDirectory()) queue.push(path.join(directory, entry.name));
  }
  return found;
}

/* Removes each git worktree inside a session's directory with git worktree
   remove, and only after its real path is inside the directory's real path,
   so the user's checkout, branches and anything outside the directory stay
   as they are. --force removes a worktree with changes the agent never
   committed, which is what a scratch worktree has, and the reviewer
   confirmed the close. A locked worktree takes a second --force, so it
   stays. The result has a line for each worktree, removed or kept. */
export async function removeWorktrees(directory) {
  const root = await fs.realpath(directory);
  const lines = [];
  for (const found of await linkedWorktrees(root)) {
    const real = await fs.realpath(found).catch(() => null);
    if (!real?.startsWith(root + path.sep)) {
      lines.push(`kept worktree ${found}, outside the session's directory`);
      continue;
    }
    try {
      await run("git", ["worktree", "remove", "--force", real], {
        cwd: real,
        env: gitEnv(),
      });
      lines.push(`removed worktree ${real}`);
    } catch (error) {
      lines.push(
        `kept worktree ${real}: ${error.stderr?.trim() || error.message}`,
      );
    }
  }
  return lines;
}
