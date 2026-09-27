// Codex exports the thread ID to the commands it runs.
export function detect(env, { ancestor }) {
  if (ancestor ? ancestor.command !== "codex" : !env.CODEX_THREAD_ID)
    return null;
  if (!env.CODEX_THREAD_ID)
    throw new Error(
      "this Codex session exports no CODEX_THREAD_ID, so it cannot be woken.",
    );
  return { harness: "codex", thread: env.CODEX_THREAD_ID };
}

export async function wake(target, line, run) {
  await run("codex", ["queue", "--thread", target.thread, "--message", line]);
}
