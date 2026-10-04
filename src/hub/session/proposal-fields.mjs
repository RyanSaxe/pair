import { requireValue } from "../../shared/util.mjs";

// The fields and flags of pair propose and the reviewer's message with
// Start, each checked before the hub changes a card.

// The agent names each proposal with a slug, such as phone-sidebar.
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Where the work runs once it starts: in this session's rounds, or in a
// session linked to this one, which this session's holder or a separate
// agent creates with pair start --from.
const places = ["here", "sub-session", "new-agent"];
// The reviewer's words with --quote are at most 4,000 characters, as an
// overall comment is.
const limits = {
  title: 80,
  delivers: 400,
  quote: 4000,
  reason: 400,
};
export const written = ["title", "delivers"];
const actions = ["revise", "start", "withdraw", "done", "reopen"];
// The flags each action takes besides --id. A new card and --revise take
// the card's fields.
const fields = [...written, "recommend", "thread", "page"];
const takes = {
  start: ["quote", "thread", "page"],
  withdraw: ["reason"],
  done: [],
  reopen: [],
};
const owners = { quote: "start", reason: "withdraw" };
const flags = [...fields, ...Object.keys(owners)];

export function words(data, name) {
  const value = typeof data[name] === "string" ? data[name].trim() : "";
  requireValue(
    value && value.length <= limits[name],
    `--${name} takes text of at most ${limits[name]} characters`,
  );
  return value;
}
export function place(value, name) {
  requireValue(
    places.includes(value),
    `${name} takes here, sub-session or new-agent`,
  );
  return value;
}
// The reviewer's optional message with Start, at most 4,000 characters as
// an overall comment is.
export function message(data) {
  if (data?.message === undefined) return "";
  requireValue(typeof data.message === "string", "A message must be text");
  const text = data.message.trim();
  requireValue(text.length <= 4000, "The message exceeds 4,000 characters");
  return text;
}
// pair propose's card ID and its one action flag, if any. Each other flag
// goes with the action that takes it.
export function proposeAction(data) {
  const id = typeof data.id === "string" ? data.id : "";
  requireValue(
    slug.test(id) && id.length <= 60,
    "--id takes a slug of lowercase letters, digits and hyphens, at most 60 characters, such as phone-sidebar",
  );
  const chosen = actions.filter((name) => data[name] !== undefined);
  requireValue(
    chosen.length <= 1,
    "pair propose takes one of --revise, --start, --withdraw, --done and --reopen",
  );
  const [action] = chosen;
  const allowed = action && action !== "revise" ? takes[action] : fields;
  const extra = flags.find(
    (name) => data[name] !== undefined && !allowed.includes(name),
  );
  requireValue(
    !extra,
    owners[extra]
      ? `--${extra} goes with --${owners[extra]}.`
      : `--${action} changes no field. Run --revise for --${extra}.`,
  );
  return { id, action };
}
