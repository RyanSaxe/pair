// A built page contains each frame module as a base64 data: URL in its import
// map. frameSource decodes them and returns their text joined.
export function frameSource(html) {
  const map = html.match(/<script type="importmap">\n(.*)\n<\/script>/);
  if (!map) return "";
  return Object.values(JSON.parse(map[1]).imports)
    .map((url) => Buffer.from(url.split(",")[1], "base64").toString())
    .join("\n");
}
