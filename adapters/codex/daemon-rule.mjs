// A Codex 0.169 session runs on the shared app-server daemon unless its
// command line opts out, by the rules in codex-rs/tui/src/daemon_startup.rs.
// Each of these flags opts out. Codex turns --search and --approve-for-me
// into -c overrides, and every -c override opts out except a boolean feature
// and two boolean TUI settings.
const optOutFlags = new Set([
  "--no-daemon",
  "--oss",
  "--profile",
  "-p",
  "--strict-config",
  "--dangerously-bypass-hook-trust",
  "--search",
  "--approve-for-me",
  "--not-so-yolo",
]);
const flagsWithValues = new Set([
  "-c",
  "--config",
  "-p",
  "--profile",
  "--enable",
  "--disable",
]);
const booleanSettings = new Set([
  "suppress_unstable_features_warning",
  "tui.fullscreen_transcript",
]);

// Codex parses the value of -c key=value as TOML, so true is a boolean and
// 'true' is a string. features and tui also take an inline table, as
// features={a=true,b=false}.
const boolean = /^(true|false)$/;
const featureTable =
  /^\{\s*[\w-]+\s*=\s*(true|false)\s*(,\s*[\w-]+\s*=\s*(true|false)\s*)*\}$/;
const tuiTable = /^\{\s*fullscreen_transcript\s*=\s*(true|false)\s*\}$/;

// overrideKind returns "feature" for a -c override that sets features,
// "setting" for one that sets a boolean TUI setting, and "opt-out" otherwise.
function overrideKind(override) {
  const at = override.indexOf("=");
  if (at === -1) return "opt-out";
  const key = override.slice(0, at).trim();
  const value = override.slice(at + 1).trim();
  if (key === "features")
    return featureTable.test(value) ? "feature" : "opt-out";
  if (key === "tui") return tuiTable.test(value) ? "setting" : "opt-out";
  if (!boolean.test(value)) return "opt-out";
  // Codex reads use_legacy_landlock as features.use_legacy_landlock.
  if (/^features\.[^.]*$/.test(key) || key === "use_legacy_landlock")
    return "feature";
  return booleanSettings.has(key) ? "setting" : "opt-out";
}

// Codex takes a flag's value after = or as the next word, and a short flag's
// value also right after the letter, as -cmodel=o3.
function flagAt(args, i) {
  const word = args[i];
  const joined =
    /^(--[^=]+)=(.*)$/s.exec(word) ?? /^(-[cp])=?(.+)$/s.exec(word);
  if (joined) return { flag: joined[1], value: joined[2], text: word, next: 1 };
  if (!flagsWithValues.has(word)) return { flag: word, text: word, next: 1 };
  const value = args[i + 1];
  const text = value === undefined ? word : `${word} ${value}`;
  return { flag: word, value: value ?? "", text, next: 2 };
}

function argumentKind(flag, value) {
  if (flag === "-c" || flag === "--config") return overrideKind(value);
  if (flag === "--enable" || flag === "--disable") return "feature";
  return optOutFlags.has(flag) ? "opt-out" : "other";
}

// daemonArguments returns, each with its value, the arguments of args that
// start Codex without its daemon, and the ones that set a feature. Before a
// session starts on the daemon, Codex compares each feature it sets with the
// daemon's own setting, in daemon_startup.rs's compatibility_warning.
export function daemonArguments(args) {
  const optOuts = [];
  const features = [];
  for (let i = 0; i < args.length;) {
    const { flag, value, text, next } = flagAt(args, i);
    const kind = argumentKind(flag, value);
    if (kind === "opt-out") optOuts.push(text);
    if (kind === "feature") features.push(text);
    i += next;
  }
  return { optOuts, features };
}
