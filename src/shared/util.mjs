import crypto from "node:crypto";
import fs from "node:fs/promises";

export const configScript =
  /(<script\b(?=[^>]*\bid=["']session-config["'])[^>]*>)[\s\S]*?(<\/script>)/i;
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
export async function atomic(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, json(value), { mode: 0o600 });
  await fs.rename(temporary, file);
}
export function embedConfig(html, config) {
  const script = json(config).replaceAll("<", "\\u003c");
  return html.replace(
    configScript,
    () =>
      `<script type="application/json" id="session-config">${script}</script>`,
  );
}
export function serializer() {
  let queue = Promise.resolve();
  return (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
}
