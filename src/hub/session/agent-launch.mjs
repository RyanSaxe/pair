import crypto from "node:crypto";
import { accepts } from "../../shared/lifecycle.mjs";
import { launchProblem, runLaunch } from "../../shared/launch.mjs";
import { allows } from "../../shared/proposal-state.mjs";
import { requireValue } from "../../shared/util.mjs";
import { adapters } from "../wake.mjs";
import { message, planFirst, refuseStart } from "./proposal-fields.mjs";

// Start agent on a card runs the user's launch script, which starts a new
// session of the holder's agent CLI in the folder where the holder ran pair
// start. The new agent's prompt tells it to run pair start --from for the
// card. The hub runs the script before it starts the card, so a failed launch
// leaves the card as it was. Both steps run inside the session's exclusive,
// and pair start --from waits for exclusive before it links, so the new agent
// always finds the card started.
export function agentLaunch(session) {
  const { config, directory } = session;
  // A holder that ran pair start before the hub recorded its folder has no
  // folder, and Start then offers Open a new agent session and Copy command,
  // as it does without a script.
  function launcher() {
    const holder = session.state.holder;
    const adapter = holder && adapters[holder.harness];
    return holder?.folder && adapter
      ? { folder: holder.folder, adapter }
      : null;
  }
  const canStartAgent = () =>
    Boolean(launcher()) && !launchProblem(config.launchScript);
  // launchAgent checks the fields that Start sends with a new agent before it
  // runs the script, because the hub starts the card only after the script
  // succeeds.
  async function launchAgent(id, data) {
    message(data);
    planFirst(data, "new-agent");
    const found = launcher();
    requireValue(
      found,
      "This session's agent ran pair start before pair recorded the folder it works in, so the hub cannot start an agent for it. Use Copy command.",
      409,
    );
    const prompt = `Run pair guide and follow what it prints. Then run pair start --from ${directory} --proposal ${id}.`;
    const command = found.adapter.launch({
      directory: found.folder,
      name: id,
      sessionId: crypto.randomUUID(),
      prompt,
    });
    try {
      await runLaunch(config.launchScript, found.folder, command);
    } catch (error) {
      throw Object.assign(error, { statusCode: 502 });
    }
  }
  // startAgent starts a proposed card with a new agent once the script
  // succeeds. For a card already started with a new agent that no session
  // links to yet, as after Copy command, it only runs the script.
  async function startAgent(id, data) {
    requireValue(
      accepts(session.state, "change"),
      "This session is closed",
      409,
    );
    const card = session.proposalItems().find((item) => item.id === id);
    requireValue(card, `No proposal ${id} in this session`, 404);
    if (card.started)
      requireValue(
        allows(card, "openAgent") && card.started.where === "new-agent",
        card.started.session
          ? `Proposal ${id} already runs in session ${card.started.session.dir}`
          : `Proposal ${id} was already started`,
        409,
      );
    else refuseStart(card);
    await launchAgent(id, data);
    if (card.started) return { proposals: session.proposalItems() };
    return session.startProposal(id, { ...data, where: "new-agent" });
  }
  return { canStartAgent, launchAgent, startAgent };
}
