import { requireValue } from "../../shared/util.mjs";

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// here runs the work in this session's rounds. sub-session and new-agent run
// it in a linked session, which this session's holder or a separate agent
// creates with pair start --from.
const places = ["here", "sub-session", "new-agent"];
// --quote has the same 4,000-character limit as the reviewer's overall
// comment.
const limits = {
  title: 80,
  delivers: 400,
  quote: 4000,
  reason: 400,
  where: 120,
};
export const written = ["title", "delivers"];
const actions = ["revise", "start", "withdraw", "done", "join", "reopen"];
const fields = [...written, "recommend", "thread", "page"];
const takes = {
  start: ["quote", "thread", "page"],
  withdraw: ["reason"],
  done: ["where"],
  join: [],
  reopen: [],
};
const owners = { quote: "start", reason: "withdraw", where: "done" };
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
// The reviewer's optional message with Start has the same 4,000-character
// limit as an overall comment.
export function message(data) {
  if (data?.message === undefined) return "";
  requireValue(typeof data.message === "string", "A message must be text");
  const text = data.message.trim();
  requireValue(text.length <= 4000, "The message exceeds 4,000 characters");
  return text;
}
// With Plan it first, the agent in the card's own session plans before it
// builds. A plan round in this session would mix with its other work, so
// planFirst refuses Plan it first for here.
export function planFirst(data, where) {
  if (data?.planFirst === undefined || data.planFirst === false) return {};
  requireValue(data.planFirst === true, "planFirst is true or false");
  requireValue(
    where !== "here",
    "Plan it first runs the work in a sub-session or with a new agent, not here",
  );
  return { planFirst: true };
}
export function proposeAction(data) {
  const id = typeof data.id === "string" ? data.id : "";
  requireValue(
    slug.test(id) && id.length <= 60,
    "--id takes a slug of lowercase letters, digits and hyphens, at most 60 characters, such as phone-sidebar",
  );
  const chosen = actions.filter((name) => data[name] !== undefined);
  requireValue(
    chosen.length <= 1,
    "pair propose takes at most one of --revise, --start, --withdraw, --done, --join or --reopen.",
  );
  const [action] = chosen;
  // A status changes only the parts of approved work, so proposeAction
  // refuses a status flag with any action or field.
  const status = ["statusDone", "statusLeft", "statusDrop"];
  if (status.some((name) => data[name] !== undefined)) {
    const extra = action ?? flags.find((name) => data[name] !== undefined);
    requireValue(
      !extra,
      `A status takes no --${extra}. Give the status in a pair propose of its own.`,
    );
    return { id, action: "status" };
  }
  const allowed = action && action !== "revise" ? takes[action] : fields;
  const extra = flags.find(
    (name) => data[name] !== undefined && !allowed.includes(name),
  );
  requireValue(
    !extra,
    owners[extra]
      ? `--${extra} goes with --${owners[extra]}.`
      : `--${action} takes no --${extra}. To edit that field, run pair propose with --revise and --${extra}.`,
  );
  return { id, action };
}
