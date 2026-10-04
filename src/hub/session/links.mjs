import { requireValue } from "../../shared/util.mjs";

// A linked session: one that pair start --from created for a proposal of
// another session, its parent. Its status.json names the parent's ID and
// directory and the proposal, and the parent's card names this session in
// started.session.
export function links(session) {
  const link = () => session.state.parent || null;
  const parentOf = () => (link() ? session.peer(link().sessionId) : null);
  // The parent's name and address, for the line under the header.
  function parentView() {
    if (!link()) return null;
    return {
      ...link(),
      title: parentOf()?.title() ?? link().sessionDir,
      url: `/s/${link().sessionId}/`,
    };
  }
  async function linkParent(parent, proposal) {
    await session.transition({
      parent: {
        sessionId: parent.id,
        sessionDir: parent.directory,
        proposal,
      },
    });
  }
  // Closing a linked session marks its card done in the parent, which the
  // parent's next pair read reports.
  async function closeLinked() {
    const parent = parentOf();
    if (!parent) return;
    await parent.exclusive(() =>
      parent.closedSession(link().proposal, session.state.sessionId),
    );
  }
  // pair plan in a linked session attaches a plan to the proposal the
  // session runs, whose card is in the parent. A card of this session's own
  // takes the plan here.
  function planOwner(id) {
    const own = session.proposalItems().some((card) => card.id === id);
    if (own || link()?.proposal !== id) return null;
    const parent = parentOf();
    requireValue(
      parent,
      `Proposal ${id} is in session ${link().sessionDir}, which the hub has not loaded. Run pair status --session-dir ${link().sessionDir}, then pair plan again.`,
      409,
    );
    return parent;
  }
  return { parentView, linkParent, closeLinked, planOwner };
}
