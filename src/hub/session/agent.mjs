import path from "node:path";
import { guideCommand } from "../../shared/guide.mjs";
import { offers } from "../../shared/offers.mjs";
import { actionOf, idPattern } from "../../shared/records.mjs";
import { atomic, read, requireValue, timestamp } from "../../shared/util.mjs";
import { adapters, identify, wakeRunner } from "../wake.mjs";
import { heldItems } from "./submissions.mjs";

const sameAgent = (a, b) => a?.harness === b?.harness && a?.id === b?.id;
// The agent's commands, the holder, and the lines that tell the agent what
// to do next.
export function agent(session) {
  const { directory, config, transition, pending, view } = session;
  const command = (name) => `pair ${name} --session-dir ${directory}`;
  // Any agent in any harness takes the session over with this line.
  const handoff = `Take over pair session ${directory}: run ${command("start")} and follow what it prints.`;
  // Each agent command is a report, and the reviewer sees when the last one
  // came. Only ack carries a note, so any other report clears the last one.
  const report = (note = null) => ({ report: { at: timestamp(), note } });
  const receive = (event) =>
    event && session.state.lastReceivedId !== event.id
      ? { lastReceivedId: event.id, receivedAt: timestamp() }
      : {};
  // A line that points at a guide file names the command that prints it.
  const guide = guideCommand;
  const offerGuide = (id) => guide(path.relative("guide", offers[id].guide));
  const actionAfter = (offer, after) =>
    offers[offer].accept.actions.find((item) => item.after === after);
  // Every agent command prints the step after it, so an agent that lost its
  // place, or skipped round.md, is told where the session stands.
  async function nextStep() {
    const [event] = await pending();
    if (event)
      return event.payload.intent === "accept"
        ? `Run ${offerGuide(event.payload.offer)} and read all it prints, then run: ${command("read")}`
        : `Run ${guide("round.md")} and read all it prints, then run: ${command("read")}`;
    if (session.state.stage === "complete") return "The session is complete.";
    if (session.state.stage === "saved") {
      const { round } = session.state.current;
      return `Round ${round} is saved for later. Say this line in chat, then end your turn: ${handoff}`;
    }
    if (session.state.accepted) {
      const { round, offer } = session.state.accepted;
      const action = actionOf(session.state.accepted);
      // A start on the saved round sent this agent on to build it.
      if (action.after === "saved")
        return `Round ${round} was saved for later, and you are building it now. Run ${offerGuide(offer)} and build the round as its ${actionAfter(offer, "round").label} section describes.`;
      return `Run ${offerGuide(offer)} and follow its ${action.label} section.`;
    }
    if (session.state.paused)
      return `The session is paused. Tell the user, and resume it with: ${command("start")}`;
    if (!session.state.current)
      return `When the first round is ready, publish Agreed with pair publish --pages before any other page. ${guide("round.md")} prints the steps.`;
    if (session.state.openRound) {
      const left = session.state.openRound.pages
        .filter((slot) => !slot.recordPath)
        .map((slot) =>
          slot.state === "active" ? `${slot.id} (started)` : slot.id,
        );
      return `Pages still to publish: ${left.join(", ")}. Run pair progress --start ID as you begin a page, run pair publish as soon as it builds, and report with pair ack --note at least every 5 minutes.`;
    }
    if (session.state.stage === "working")
      return `Update the task and Agreed from the feedback, then publish Agreed with pair publish --pages before any other page. ${guide("round.md")} prints the steps. Report with pair ack --note at least every five minutes.`;
    return "The round is with the reviewer. Say in chat what changed if you have not, then end the turn. The hub wakes you when they submit.";
  }
  // Runs after the submission is saved, outside the browser's request, so a
  // slow or failing harness never delays the reviewer's Sent session.state.
  async function wakeAgent(round) {
    const line = `pair: feedback arrived on session ${directory} (Round ${round}). Run first: ${command("ack")}. It prints the next step.`;
    let last;
    try {
      await wakeRunner(session.wake, line);
      last = { at: timestamp(), ok: true };
    } catch (error) {
      last = { at: timestamp(), ok: false, reason: error.message };
    }
    await transition({ wake: { harness: session.wake.harness, last } });
  }
  /* Closing a session from the browser. complete() refuses without an
     acceptance, so ending an abandoned session needs its own door. */
  async function dismiss() {
    await transition({ stage: "complete", dismissedAt: timestamp() });
    return { status: view() };
  }
  // The next command of an agent the session was taken from fails, start
  // included, so it stops instead of publishing over its successor. After
  // that it is told, like any agent that does not hold the session, how to
  // take the session over, which it does only when the user asks.
  async function requireHolder(agent, start = false) {
    const clock = (at) => new Date(at).toTimeString().slice(0, 5);
    const former = (session.state.formerHolders || []).find((item) =>
      sameAgent(item, agent),
    );
    if (former) {
      await transition({
        formerHolders: session.state.formerHolders.filter(
          (item) => item !== former,
        ),
      });
      requireValue(
        false,
        `Another agent took this session over at ${clock(former.until)}. Stop working on it.`,
        409,
      );
    }
    if (
      !start &&
      session.state.holder &&
      !sameAgent(session.state.holder, agent)
    )
      requireValue(
        false,
        `Another agent has held this session since ${clock(session.state.holder.at)}. Stop working on it unless the user asks you to take it over with: ${command("start")}`,
        409,
      );
  }
  async function readFeedback(data) {
    // With an id, read returns that submission again and changes nothing,
    // for a turn that resumes after an interruption.
    if (data.id !== undefined) {
      requireValue(idPattern.test(data.id || ""), "Submission ID required");
      const event = await read(
        path.join(directory, "feedback", data.id + ".json"),
      );
      return {
        status: view(),
        event: session.withDrawingPaths(event),
        next: await nextStep(),
      };
    }
    const [event] = await pending();
    if (!event) return { status: view(), event: null, next: await nextStep() };
    const patch = {
      ...report(),
      ...receive(event),
      stage: session.state.stage === "saved" ? "saved" : "working",
      acknowledged: [...session.state.acknowledged, event.id],
      acknowledgedAt: timestamp(),
      lastAcknowledgedId: event.id,
    };
    if (event.payload.intent === "accept") {
      patch.accepted = {
        eventId: event.id,
        ...session.state.current,
        action: event.payload.action,
        ...(event.payload.guidance ? { guidance: event.payload.guidance } : {}),
        ...(heldItems(event.payload.groups)
          ? { groups: event.payload.groups }
          : {}),
        acceptedAt: event.receivedAt,
      };
      await atomic(path.join(directory, "acceptance.json"), patch.accepted);
    }
    await transition(patch);
    return {
      status: view(),
      event: session.withDrawingPaths(event),
      next: await nextStep(),
    };
  }
  async function ack(data) {
    requireValue(
      data.note === undefined ||
        (typeof data.note === "string" && data.note.trim().length <= 80),
      "An ack note is text of at most 80 characters",
    );
    const [event] = await pending();
    await transition({
      ...report(data.note?.trim() || null),
      ...receive(event),
    });
    return {
      status: view(),
      received: event ? { id: event.id, intent: event.payload.intent } : null,
      next: await nextStep(),
    };
  }
  async function pause(data) {
    requireValue(
      typeof data.reason === "string" && data.reason.trim(),
      "pause requires a reason",
    );
    await transition({
      paused: { at: timestamp(), reason: data.reason.trim() },
    });
    return { status: view() };
  }
  async function complete() {
    requireValue(
      session.state.accepted,
      "Acknowledge acceptance of the current round before completing",
      409,
    );
    const action = actionOf(session.state.accepted);
    if (action.after !== "complete")
      requireValue(
        false,
        `${action.label} keeps the session, so it does not complete. ${await nextStep()}`,
        409,
      );
    await transition({ stage: "complete" });
    return { status: view() };
  }
  // The actions an agent command sends, by the command that sends it.
  const actions = {
    status: async () => ({ status: view() }),
    read: readFeedback,
    ack,
    progress: (data) => session.pageProgress(data),
    pause,
    publish: (data) => session.publishPage(data.html, data.source, data.pages),
    complete,
  };
  async function act(data) {
    requireValue(
      data.sessionId === session.state.sessionId,
      "Wrong session",
      409,
    );
    // status only reads, so any agent, or none, may run it.
    if (data.action !== "status") await requireHolder(data.agent);
    requireValue(Object.hasOwn(actions, data.action), "Unknown agent action");
    return actions[data.action](data);
  }
  // pair start makes its agent the holder, the one agent the hub wakes. Any
  // other registration, such as a command reattaching to a new hub, changes
  // nothing when it comes from an agent other than the holder. start on a
  // saved round builds it, from any agent and whether or not the Save was
  // read, with one exception: the holder's own start while its Save is unread
  // resumes an interrupted turn, which reads the Save and says the handoff
  // line. Once the holder has read the Save, its start builds too, such as
  // from a new conversation in the same Claude Code process.
  async function hold(target, start) {
    const agent = identify(target);
    const held = session.state.holder;
    const same = sameAgent(held, agent);
    // act() then answers or refuses the command, so a former holder's pair
    // status keeps its takeover notice.
    if (!start && held && !same) return null;
    const unread = (await pending()).length > 0;
    await requireHolder(agent, start);
    await atomic(session.wakeFile, target);
    session.wake = target;
    const patch = {
      wake: { harness: target.harness, last: session.state.wake?.last || null },
      paused: null,
    };
    if (!same) {
      patch.holder = { ...agent, at: timestamp() };
      // The reviewer's card says who took over, until they next submit.
      if (held)
        Object.assign(patch, report(), {
          takeover: { name: adapters[agent.harness].name, at: patch.holder.at },
          wake: { harness: target.harness, last: null },
          formerHolders: [
            ...(session.state.formerHolders || []),
            { harness: held.harness, id: held.id, until: patch.holder.at },
          ],
        });
    }
    // A build clears the failed wake of the Save, so the card follows the
    // build and not a harness that had exited.
    const build = start && session.state.stage === "saved" && !(same && unread);
    if (build)
      Object.assign(patch, report(), {
        stage: "working",
        latestSubmissionRound: session.state.current.round,
        wake: { harness: target.harness, last: null },
      });
    await transition(patch);
    return build ? buildNext(unread) : null;
  }
  // The acceptance keeps its save action, so the line says outright that
  // this agent builds the plan.
  async function buildNext(unread) {
    const { round, offer } = session.state.current;
    const reading = unread
      ? command("read")
      : `${command("read")} --id ${session.state.accepted.eventId}`;
    return `Round ${round} was saved for later, and you now build it. Run ${offerGuide(offer)} and read all it prints, then run: ${reading}. It prints the acceptance with the reviewer's comments, and its action stays ${actionAfter(offer, "saved").id}. Build the plan as its ${actionAfter(offer, "round").label} section describes.`;
  }
  return { handoff, report, nextStep, wakeAgent, dismiss, act, hold };
}
