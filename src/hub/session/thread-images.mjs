import {
  IMG_TAG,
  imageAttributes,
  imageSize,
} from "../../build/image-size.mjs";
import { requireValue } from "../../shared/util.mjs";

/* An agent's reply can hold screenshots as data: URLs, and every status the
   frame reads holds every thread of the session. The view of a thread
   therefore names each image by an address on the hub, so the frame loads an
   image only when it draws its card. A tag keeps its data: URL when the hub
   cannot write the image's whole box, because a card would otherwise grow when
   the image arrives. The stored thread keeps the data: URLs, so pair read
   prints what the agent wrote. */

// The browser opens an SVG at its own address as a document and runs its
// scripts, so an SVG stays in its tag.
const dataImage = /^data:(image\/(?:png|jpeg|webp|gif));base64,/i;
const pixels = (value) => /^\d+$/.test(value);
function missingSize({ width, height }, natural) {
  if (width === undefined && height === undefined) return natural;
  if (![width, height].every((side) => side === undefined || pixels(side)))
    return null;
  if (width === undefined)
    return { width: Math.round((height * natural.width) / natural.height) };
  if (height === undefined)
    return { height: Math.round((width * natural.height) / natural.width) };
  return {};
}
function separate(html, addressOf) {
  const images = [];
  const light = html.replace(IMG_TAG, (tag) => {
    const attributes = imageAttributes(tag);
    const source = attributes.src;
    const found = source?.match(dataImage);
    if (!found) return tag;
    const base64 = source.slice(found[0].length);
    const natural = imageSize(Buffer.from(base64, "base64"));
    const size = natural && missingSize(attributes, natural);
    if (!size) return tag;
    const close = tag.endsWith("/>") ? "/>" : ">";
    const start = tag
      .slice(0, -close.length)
      .trimEnd()
      .replace(source, () => addressOf(images.length));
    images.push({ type: found[1].toLowerCase(), base64 });
    return `${start}${Object.entries(size)
      .map(([name, value]) => ` ${name}="${value}"`)
      .join("")}${close}`;
  });
  return { html: light, images };
}
export function replyImages(base) {
  // A status holds every thread, and the hub only appends a thread's messages,
  // so each reply is separated once.
  const separated = new WeakMap();
  const parts = (thread, index) => {
    const message = thread.messages[index];
    if (!separated.has(message))
      separated.set(
        message,
        separate(
          message.html,
          (image) =>
            `${base}/api/thread-image/${encodeURIComponent(thread.id)}/${index}/${image}`,
        ),
      );
    return separated.get(message);
  };
  return {
    lighten: (thread) => ({
      ...thread,
      messages: thread.messages.map((message, index) =>
        message.html === undefined
          ? message
          : { ...message, html: parts(thread, index).html },
      ),
    }),
    read(thread, index, image) {
      const found =
        thread.messages[index]?.html === undefined
          ? undefined
          : parts(thread, index).images[image];
      requireValue(found, "This thread has no such image", 404);
      return {
        type: found.type,
        bytes: Buffer.from(found.base64, "base64"),
      };
    },
  };
}
