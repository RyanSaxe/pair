import crypto from "node:crypto";
import fs from "node:fs/promises";

export const json = (value) => JSON.stringify(value, null, 2);
export const exists = async (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );
export const read = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
export const timestamp = () => new Date().toISOString();
export function requireValue(condition, message, code = 400) {
  if (!condition) throw Object.assign(new Error(message), { statusCode: code });
}
// Text is written as it is, and anything else as JSON.
export async function atomic(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const text = typeof value === "string" ? value : json(value);
  await fs.writeFile(temporary, text, { mode: 0o600 });
  await fs.rename(temporary, file);
}
// JSON inside a <script> element escapes "<", so no string in it can end
// the element.
export const scriptJson = (value, space) =>
  JSON.stringify(value, null, space).replaceAll("<", "\\u003c");
export const jsonScriptTag = (id, value, space) =>
  `<script type="application/json" id="${id}">${scriptJson(value, space)}</script>`;
// The application/json <script> element with this id. The first group is
// its JSON.
export const jsonScript = (id) =>
  new RegExp(
    `<script\\b(?=[^>]*\\bid=["']${id}["'])(?=[^>]*\\btype=["']application\\/json["'])[^>]*>([\\s\\S]*?)<\\/script>`,
    "i",
  );
export function embedConfig(html, config) {
  return html.replace(jsonScript("session-config"), () =>
    jsonScriptTag("session-config", config, 2),
  );
}
export const listen = (server, port, host = "127.0.0.1") =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
export function serializer() {
  let queue = Promise.resolve();
  return (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
}
