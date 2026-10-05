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
  return { parentView, linkParent, closeLinked };
}
