/* The frame draws the card the hub has under data-proposal, with its state
   and its actions, and draws it again whenever the card changes. Where no
   hub has the card, the text inside stays. */
planUI.define("proposal", {
  match: ".proposal[data-proposal]",
  setup(root, { planUI }) {
    planUI.proposal(root);
  },
});
