// The frame's modules as a built page carries them: each one a base64 data:
// URL in the page's import map. Returns their text, joined.
export function frameSource(html) {
  const map = html.match(/<script type="importmap">\n(.*)\n<\/script>/);
  if (!map) return "";
  return Object.values(JSON.parse(map[1]).imports)
    .map((url) => Buffer.from(url.split(",")[1], "base64").toString())
    .join("\n");
}
