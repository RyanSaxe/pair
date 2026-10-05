import { base, editable } from "#frame/app/view.mjs";
import { remote } from "#frame/sync/rounds.mjs";

/* The links on a card, on Work and in the proposal component: to the page
   or thread the card came from, to the session its work runs in, and to
   where the reviewer wrote the words that started it. */

const element = (tag, text) => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
// A link to the session work runs in, which opens in this tab.
export function sessionLink(text, session) {
  const link = element("a", text);
  link.href = session.url;
  return link;
}
// A link to a page of a round: in place for the round on screen, and on
// the round's read-only page for an earlier one.
export function pageLink(text, round, id) {
  const link = element("a", text);
  if (round === remote?.current?.round && editable) {
    link.href = `#${id}`;
    link.dataset.page = id;
  } else link.href = `${base}/r/${encodeURIComponent(round)}#${id}`;
  return link;
}
// The page a card came up on, by the title the hub recorded with the card.
// A card recorded before the hub kept the title reads From a page.
export const fromPage = ({ id, title }) =>
  id === "agreed"
    ? "From Agreed so far"
    : title
      ? `From the ${title} page`
      : "From a page";
export function threadLink(text, id) {
  const thread = remote?.threads?.find((item) => item.id === id);
  if (!thread) return element("span", text);
  const link = element("a", text);
  const target = `?target=thread-${encodeURIComponent(id)}`;
  if (thread.proposal) link.href = `${target}#work`;
  else
    link.href =
      thread.round === remote.current?.round
        ? `${base}/${target}#${thread.topic}`
        : `${base}/r/${encodeURIComponent(thread.round)}${target}#${thread.topic}`;
  return link;
}
// Where the reviewer wrote the words that started a card, as a link, when
// the agent gave it.
export function wordsPlace({ thread, page }) {
  if (thread) return threadLink("in a thread", thread);
  if (!page) return null;
  const text =
    page.id === "agreed"
      ? "on Agreed so far"
      : page.title
        ? `on the ${page.title} page`
        : "on a page";
  return pageLink(text, page.round, page.id);
}
