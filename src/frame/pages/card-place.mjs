import { scroller } from "#frame/app/places.mjs";
import { $ } from "#frame/app/util.mjs";

/* A redraw of Work replaces every card, so the browser has no element left to
   keep in place, and a card that changes height or leaves the list moves all
   the cards under it. readPlace() records where the blocks on screen are before
   a redraw. A block is a card or a thread card. restore() then scrolls one of
   them back to where it was, in the same task, so the browser paints no frame
   in between. */

const blockName = ({ dataset }) =>
  dataset.proposalCard
    ? `[data-proposal-card="${CSS.escape(dataset.proposalCard)}"]`
    : dataset.thread &&
      `pair-thread[data-thread="${CSS.escape(dataset.thread)}"]`;
const rectOf = ({ name }) =>
  $("work-view").querySelector(name)?.getBoundingClientRect();

// acted is the ID of the card the reader last pressed a button on.
export function readPlace(acted) {
  const box = scroller();
  const list = $("work-cards");
  const { top: edge, bottom: end } = box.getBoundingClientRect();
  const onScreen = (node) => {
    const { top, bottom } = node.getBoundingClientRect();
    return bottom > edge + 1 && top < end - 1;
  };
  // A card's thread cards follow it in the list, so a reader of the thread is
  // reading that card.
  const cards = new Set();
  let card = null;
  for (const node of list.children) {
    card = node.dataset.proposalCard ?? card;
    if (card && onScreen(node)) cards.add(card);
  }
  const blocks = [...list.children, ...$("work-threads").children]
    .filter((node) => blockName(node) && onScreen(node))
    .map((node) => {
      const { top, height } = node.getBoundingClientRect();
      return {
        name: blockName(node),
        id: node.dataset.proposalCard,
        top,
        height,
      };
    });
  // The block that the top of the window cuts off comes last, so restore()
  // uses it only when no other block is on screen.
  const places = [
    ...blocks.filter(({ top }) => top >= edge),
    ...blocks.filter(({ top }) => top < edge),
  ];
  function restore() {
    // A card that changed height has to move either its own top or the cards
    // under it. The cards the reader may be reading are the ones that did not
    // change, unless the reader just pressed a button on this one.
    const place =
      places.find(({ id }) => id && id === acted) ??
      places.find(
        (item) => Math.abs(rectOf(item)?.height - item.height) < 0.5,
      ) ??
      places[0];
    if (!place || !rectOf(place)) return;
    const moved = () => rectOf(place).top - place.top;
    if (moved()) box.scrollTop += moved();
    // The end of the page stopped the scroll, because the cards below got
    // shorter, so the list makes up the height they lost.
    const short = moved();
    if (short < 1) return;
    const padding = parseFloat(list.style.paddingBottom) || 0;
    list.style.paddingBottom = `${padding + short}px`;
    box.scrollTop += short;
  }
  return { cards, restore };
}
