import { requireValue } from "../../shared/util.mjs";

// A linked session is one that pair start --from created for a proposal of
// another session, its parent. Its status.json contains the parent's ID and
// directory and the proposal, and the parent's card contains this session in
// started.session.
export function links(session) {
  const link = () => session.state.parent || null;
  const parentOf = () => (link() ? session.peer(link().sessionId) : null);
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
  async function closeLinked() {
    const parent = parentOf();
    if (!parent) return;
    await parent.exclusive(() =>
      parent.closedSession(link().proposal, session.state.sessionId),
    );
  }
  // When the reviewer starts a card with Plan it first, the agent of the
  // linked session plans before it builds, so hold gives pair start --from
  // the start-from-plan moment.
  const plansFirst = () =>
    Boolean(
      parentOf()
        ?.proposalItems()
        .find((card) => card.id === link()?.proposal)?.started?.planFirst,
    );
  // submit calls buildLinked when the reviewer chooses Build it in a linked
  // session, and parent.built marks the parent's card as building instead of
  // planning.
  async function buildLinked() {
    const parent = parentOf();
    if (!parent) return;
    await parent.exclusive(() =>
      parent.built(link().proposal, session.state.sessionId),
    );
  }
  // In a linked session, pair propose can set the status of the proposal
  // that the session builds, whose card is in the parent, so cardOwner
  // returns the parent. When this session has its own card with that ID, the
  // status goes to that card instead.
  function cardOwner(id, command) {
    const own = session.proposalItems().some((card) => card.id === id);
    if (own || link()?.proposal !== id) return null;
    const parent = parentOf();
    requireValue(
      parent,
      `Proposal ${id} is in session ${link().sessionDir}, which the hub has not loaded. Run pair status --session-dir ${link().sessionDir}, then ${command} again.`,
      409,
    );
    return parent;
  }
  return {
    parentView,
    linkParent,
    closeLinked,
    plansFirst,
    buildLinked,
    cardOwner,
  };
}
