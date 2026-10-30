/* The frame draws the hub's card for the ID in data-proposal, with its state
   and its actions, and draws it again whenever the card changes. When the
   hub has no card with that ID, the author's text inside stays. */
planUI.define("proposal", {
  match: ".proposal[data-proposal]",
  setup(root, { planUI }) {
    planUI.proposal(root);
  },
});
