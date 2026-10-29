import { base, editable } from "#frame/app/view.mjs";
import { remote } from "#frame/sync/rounds.mjs";

const element = (tag, text) => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
export function sessionLink(text, session) {
  const link = element("a", text);
  link.href = session.url;
  return link;
}
export function pageLink(text, round, id) {
  const link = element("a", text);
  if (round === remote?.current?.round && editable) {
    link.href = `#${id}`;
    link.dataset.page = id;
  } else link.href = `${base}/r/${encodeURIComponent(round)}#${id}`;
  return link;
}
// A card that the hub recorded before it saved page titles has no title, so
// fromPage() returns "From a page" for it.
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
// wordsPlace() links to where the reviewer wrote the words that started a
// card, when the agent recorded that place.
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
