// opencode 1's task tool titles a subagent's session "TASK (@AGENT subagent)",
// and opencode 2's titles it TASK. pair names a subagent by its task.
export function parseTitle(title) {
  const [, named, agent] = /^(.*) \(@(.+) subagent\)$/.exec(title) ?? [];
  return { task: named ?? title, agent };
}

// newestSubagent returns the newest of a session's child sessions whose task,
// title or agent is name, ignoring case.
export function newestSubagent(children, name) {
  const wanted = name.toLowerCase();
  const named = children.filter((child) =>
    [child.title, child.agent, ...Object.values(parseTitle(child.title))].some(
      (each) => each?.toLowerCase() === wanted,
    ),
  );
  if (!named.length) {
    throw new Error(
      `The opencode session has no subagent named ${name}. ${children.length ? `Its subagents are ${children.map((child) => parseTitle(child.title).task).join(", ")}.` : "It has no subagents."}`,
    );
  }
  return named.reduce((newest, child) =>
    child.time.created > newest.time.created ? child : newest,
  );
}
