export const name = "Codex";

// Codex exports the thread ID to the commands it runs.
export const command = "codex";
export const variables = ["CODEX_THREAD_ID"];
export const unwakeable =
  "this Codex session exports no CODEX_THREAD_ID, so it cannot be woken.";

export const identity = (target) => target.thread;

export const detect = (env) => ({
  harness: "codex",
  thread: env.CODEX_THREAD_ID,
});

export async function wake(target, line, run) {
  await run("codex", ["queue", "--thread", target.thread, "--message", line]);
}
