import path from "node:path";
import { exists, requireValue } from "../shared/util.mjs";

// pair start --from creates a session for a proposal of the session at
// from, and links the two both ways: the new session's status names the
// parent, and the parent's card names the new session. adopt loads a
// session by its directory, as the hub's registry does.
export async function startFrom(adopt, directory, created, data) {
  requireValue(
    typeof data.from === "string" && path.isAbsolute(data.from),
    "from must be an absolute path",
  );
  requireValue(
    typeof data.proposal === "string" && data.proposal,
    "pair start --from takes --proposal ID",
  );
  requireValue(created, "pair start --from creates a new session");
  const from = path.resolve(data.from);
  requireValue(
    await exists(path.join(from, "status.json")),
    `No pair session at ${from}. --from takes the directory of the session the proposal is in.`,
  );
  const parent = await adopt(from);
  await parent.exclusive(async () => parent.linkable(data.proposal));
  const session = await adopt(directory);
  await session.exclusive(() => session.linkParent(parent, data.proposal));
  const card = await parent.exclusive(() =>
    parent.linkSession(data.proposal, {
      id: session.id,
      dir: session.directory,
      url: session.base + "/",
    }),
  );
  // The new session builds the work of the cards joined into the proposal
  // too.
  return { session, card, joined: parent.joinedInto(card.id) };
}

// The open sessions, and each closed session that a session linked to it,
// or to one linked to it, keeps listed, so Sessions draws it as the heading
// of its open sub-sessions. find returns the session with an ID.
export function withClosedParents(open, find) {
  const kept = new Set(open);
  for (const session of open) {
    let link = session.state.parent;
    while (link) {
      const parent = find(link.sessionId);
      if (!parent || kept.has(parent)) break;
      kept.add(parent);
      link = parent.state.parent;
    }
  }
  return [...kept];
}
