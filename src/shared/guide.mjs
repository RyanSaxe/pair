import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { offers } from "./offers.mjs";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const markdownLink = /\]\(([^()\s]+)\)/g;
const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

// The guide's files link each other and the components by relative paths, so
// they read correctly in the repository. The agent reads a copy whose links
// are absolute paths, so it never resolves one. The copy lives under the state
// directory because pair never changes its own files: with npm link, the
// installed package is the git checkout.
async function readGuide() {
  const documents = [
    ...(await fs.readdir(path.join(packageRoot, "guide")))
      .filter((file) => file.endsWith(".md"))
      .map((file) => `guide/${file}`),
    ...Object.values(offers).map((offer) => offer.guide),
    "src/components/README.md",
  ];
  const texts = await Promise.all(
    documents.map((document) =>
      fs.readFile(path.join(packageRoot, document), "utf8"),
    ),
  );
  // A copy is named by what it holds, the guide and the package its links
  // point into, so commands and hubs that run different versions or
  // installations never overwrite or reuse each other's copy.
  const hash = crypto.createHash("sha256").update(`${packageRoot}\0`);
  for (const [index, document] of documents.entries())
    hash.update(`${document}\0${texts[index]}\0`);
  return { documents, texts, name: hash.digest("hex").slice(0, 12) };
}
// The hub names a guide file in the next line of every agent command, so a
// process reads and hashes the guide once rather than for each line. An edit
// to the guide reaches a running hub when the hub restarts.
let guide;
export async function guideFile(name, stateRoot) {
  guide ||= readGuide();
  const { documents, texts, name: copyName } = await guide;
  const copy = path.join(stateRoot, "guide", copyName);
  const named = path.join(copy, "guide", name);
  if (await exists(copy)) return named;
  const temporary = `${copy}.${crypto.randomUUID()}.tmp`;
  for (const [index, document] of documents.entries()) {
    const text = texts[index].replace(markdownLink, (_, target) => {
      const linked = path.resolve(packageRoot, path.dirname(document), target);
      const inPackage = path.relative(packageRoot, linked);
      return documents.includes(inPackage)
        ? `](${path.join(copy, inPackage)})`
        : `](${linked})`;
    });
    const written = path.join(temporary, document);
    await fs.mkdir(path.dirname(written), { recursive: true });
    await fs.writeFile(written, text);
  }
  // The rename shows the whole copy at once. When another command finished
  // the same copy first, its copy stays.
  await fs.rename(temporary, copy).catch(async (error) => {
    await fs.rm(temporary, { recursive: true, force: true });
    if (!(await exists(copy))) throw error;
  });
  return named;
}
