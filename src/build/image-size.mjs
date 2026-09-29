/* pair build writes the width and height of each image a page embeds as a
   data: URL, so the browser reserves the image's box before it decodes the
   image. imageSize() reads them from a PNG, JPEG, WebP or GIF header, and
   svgSize() from an SVG's viewBox. Each returns null for a header it cannot
   read, and the image then keeps no size. */
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

function dimensions(width, height) {
  return Number.isFinite(width) &&
    width > 0 &&
    Number.isFinite(height) &&
    height > 0
    ? { width, height }
    : null;
}

function matches(bytes, offset, text) {
  return [...text].every(
    (char, index) => bytes[offset + index] === char.charCodeAt(0),
  );
}

function pngSize(bytes) {
  if (
    bytes.length < 24 ||
    !pngSignature.every((byte, index) => bytes[index] === byte)
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dimensions(view.getUint32(16), view.getUint32(20));
}

function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const frames = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (frames.has(marker)) {
      if (length < 7) return null;
      return dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
    }
    offset += length;
  }
  return null;
}

function webpSize(bytes) {
  if (
    bytes.length < 20 ||
    !matches(bytes, 0, "RIFF") ||
    !matches(bytes, 8, "WEBP")
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (matches(bytes, 12, "VP8X") && bytes.length >= 30)
    return dimensions(
      1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    );
  if (matches(bytes, 12, "VP8L") && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return dimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
  }
  if (
    matches(bytes, 12, "VP8 ") &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  )
    return dimensions(
      view.getUint16(26, true) & 0x3fff,
      view.getUint16(28, true) & 0x3fff,
    );
  return null;
}

function gifSize(bytes) {
  if (
    bytes.length < 10 ||
    !(matches(bytes, 0, "GIF87a") || matches(bytes, 0, "GIF89a"))
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dimensions(view.getUint16(6, true), view.getUint16(8, true));
}

export function imageSize(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  return pngSize(bytes) || jpegSize(bytes) || webpSize(bytes) || gifSize(bytes);
}

export function svgSize(text) {
  const viewBox = text.match(/<svg\b[^>]*\bviewBox\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (!viewBox) return null;
  const [, , width, height] = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return dimensions(Math.round(width), Math.round(height));
}

function dataImageSize(source) {
  const comma = source.indexOf(",");
  if (comma < 0) return null;
  const metadata = source.slice(5, comma).split(";");
  const mediaType = metadata[0].toLowerCase();
  const payload = source.slice(comma + 1);
  let body;
  try {
    body = metadata.includes("base64")
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload));
  } catch {
    return null;
  }
  if (mediaType === "image/svg+xml") return svgSize(body.toString("utf8"));
  return imageSize(body);
}

function imageAttributes(tag) {
  const attributes = {};
  let index = tag.match(/^<img\b/i)[0].length;
  while (index < tag.length) {
    while (/\s/.test(tag[index] || "")) index++;
    if (tag[index] === "/" || tag[index] === ">") break;
    const start = index;
    while (index < tag.length && !/[\s=/>]/.test(tag[index])) index++;
    if (index === start) {
      index++;
      continue;
    }
    const name = tag.slice(start, index).toLowerCase();
    while (/\s/.test(tag[index] || "")) index++;
    let value = null;
    if (tag[index] === "=") {
      index++;
      while (/\s/.test(tag[index] || "")) index++;
      const quote =
        tag[index] === '"' || tag[index] === "'" ? tag[index++] : null;
      const valueStart = index;
      if (quote) {
        while (index < tag.length && tag[index] !== quote) index++;
      } else {
        while (index < tag.length && !/[\s>]/.test(tag[index])) index++;
      }
      value = tag.slice(valueStart, index);
      if (quote) index++;
    }
    attributes[name] = value;
  }
  return attributes;
}

// An img tag, whose quoted attribute values can contain ">".
const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
export function sizeImages(html) {
  return html.replace(IMG_TAG, (tag) => {
    const attributes = imageAttributes(tag);
    if ("width" in attributes || "height" in attributes) return tag;
    const source = attributes.src;
    if (!source?.startsWith("data:")) return tag;
    const size = dataImageSize(source);
    if (!size) return tag;
    const close = tag.endsWith("/>") ? "/>" : ">";
    const start = tag.slice(0, -close.length).replace(/\s+$/, "");
    return `${start} width="${Math.round(size.width)}" height="${Math.round(size.height)}"${close}`;
  });
}
