// Picks the version a merge into main publishes, from the version npm
// already has and the merged pull request's labels, and prints it as
// version=X.Y.Z for the release workflow. It prints nothing for a pull
// request labelled skip-release.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function nextVersion(published, labels) {
  if (labels.includes("skip-release")) return null;
  if (!published) return "0.1.0";
  const [major, minor, patch] = published.split(".").map(Number);
  if (labels.includes("major")) return `${major + 1}.0.0`;
  if (labels.includes("minor")) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function published(name) {
  try {
    const out = execFileSync("npm", ["view", name, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim() || null;
  } catch (error) {
    // A package npm has never seen gets its first version.
    if (String(error.stderr).includes("E404")) return null;
    throw error;
  }
}

function labels(sha) {
  const pulls = JSON.parse(
    execFileSync(
      "gh",
      ["api", `repos/${process.env.GITHUB_REPOSITORY}/commits/${sha}/pulls`],
      { encoding: "utf8" },
    ),
  );
  return pulls.flatMap((pull) => pull.labels.map((label) => label.name));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { name } = JSON.parse(readFileSync("package.json", "utf8"));
  const version = nextVersion(published(name), labels(process.argv[2]));
  if (version) console.log(`version=${version}`);
}
