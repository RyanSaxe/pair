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
  // noteAt keeps the time of the last note, whose age shows beside the note
  // under the progress card's title, so a report without a note does not
  // reset it.
  const report = (note = null) => {
    const at = timestamp();
    const noteAt = note ? at : session.state.report?.noteAt;
    return { report: { at, note, ...(noteAt ? { noteAt } : {}) } };
  };
  const receive = (event) =>
    event && session.state.lastReceivedId !== event.id
      ? { lastReceivedId: event.id, receivedAt: timestamp() }
      : {};
  // A line that points at a guide file names the command that prints it.
  const offerGuide = (id) =>
    guideCommand(path.posix.relative("guide", offers[id].guide));
  const actionAfter = (offer, after) =>
    offers[offer].accept.actions.find((item) => item.after === after);
  // A line that says to publish Agreed also says which offer it names.
  const offerChoice = `If this round is the final plan, Agreed names "offer": "plan" and pages.json lists ${offers.plan.firstPage} first. If you build the work in this round, Agreed names "offer": "finish".`;
  // The round an accepted plan is built in starts with its Agreed, and its
  // steps come from the accepted round's page sources.
  const buildRound = (round) =>
    `Publish the build round's Agreed with "offer": "finish" before you change anything. The accepted round's page sources are in ${path.join(directory, "src", round)}${path.sep}, one directory per page.`;
  // Every agent command prints the step after it, so an agent that lost its
  // place is told where the session stands.
  async function nextStep() {
    const [event] = await pending();
    if (event) return `Run: ${command("read")}`;
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
        return `Round ${round} was saved for later, and you are building it now. Run ${offerGuide(offer)} and build the round as its ${actionAfter(offer, "round").label} section describes. ${buildRound(round)}`;
      if (action.after === "round")
        return `Run ${offerGuide(offer)} and follow its ${action.label} section. ${buildRound(round)}`;
      return `Run ${offerGuide(offer)} and follow its ${action.label} section.`;
    }
    if (session.state.paused)
      return `The session is paused. Tell the user, and resume it with: ${command("start")}`;
    if (!session.state.current)
      return `Publish round 1's Agreed and page list with pair publish within minutes, before you research or write any page. ${offerChoice}`;
    const building = session.state.current.offer === "finish";
    if (session.state.openRound) {
      const left = session.state.openRound.pages
        .filter((slot) => !slot.recordPath)
        .map((slot) =>
          slot.state === "active" ? `${slot.id} (started)` : slot.id,
        );
      const [begin, publish] = building
        ? [
            "Before you start the step a page shows",
            "Run pair publish when the step is done and checked.",
          ]
        : [
            "As you begin a page",
            "Run pair publish as soon as the page builds.",
          ];
      return `Pages still to publish: ${left.join(", ")}. ${begin}, and at least every five minutes while you or a subagent work on it, run pair progress --page ID --note "…". ${publish}`;
    }
    if (session.state.stage === "working")
      return building
        ? `Update the task and Agreed from this feedback, then publish Agreed with "offer": "finish" before you change anything. Build this round as the ${actionAfter("plan", "round").label} section of ${offerGuide("plan")} describes, with the pull request description, updated to the work as it now stands, as its last page.`
        : `Update the task and Agreed from this feedback, then publish Agreed and the page list with pair publish within minutes, before you research or write any page. ${offerChoice}`;
    return `Round ${session.state.current.round} is published. Say in chat what changed if you have not, then end your turn. The hub sends a wake message when the reviewer submits.`;
  }
  // The first Agreed of a session says whether to open its URL. A pair tab
  // that polled the hub recently lists the new session in its bell and
  // session list, so the agent opens a second tab only when none did.
  const browserLine = (url) =>
    session.tabOpen()
      ? `A pair tab is open in the user's browser, and its session list and bell show this session. Give the link ${url} in chat, and do not open a tab.`
      : `Open ${url} in the user's default browser (macOS open, Windows Start-Process, Linux xdg-open, with the URL quoted), and give the link in chat.`;
  // Every wake runs here: a submission's, a thread message's and Start in
  // parallel's. The result has ok, the reason when the wake failed, and via,
  // the path the line took. Each wake also sets holder.steerable, which the
  // frame reads to say when the agent reads a message.
  async function sendWake(line) {
    let result;
    try {
      requireValue(session.wake, "The session has no agent to wake");
      result = (await wakeRunner(session.wake, line, session.config)) || {};
    } catch (error) {
      return { at: timestamp(), ok: false, reason: error.message };
    }
    if (result.steerable !== undefined && session.state.holder)
      await transition({
        holder: { ...session.state.holder, steerable: result.steerable },
      });
    return {
      at: timestamp(),
      ok: true,
      ...(result.via ? { via: result.via } : {}),
    };
  }
  // What a publish adds to its answer. It names its moment: Agreed with its
  // offer, a page while pages remain, or the round's last page. A final plan
  // opens on overview, and the reviewer can accept it only when Agreed names
  // the plan offer, so an Agreed that lists overview first with no offer
  // publishes with a warning.
  function afterPublish(result, id, offer) {
    const agreed = id === "agreed";
    const { firstPage } = offers.plan;
    const unoffered =
      agreed && !offer && result.status.openRound.pages[0].id === firstPage;
    return {
      moment: agreed
        ? `publish-agreed${offer ? `-${offer}` : ""}`
        : result.roundComplete
          ? "publish-last-page"
          : "publish-page",
      ...(unoffered
        ? {
            warning: `${firstPage} is the first page and Agreed names no offer, so the reviewer can only send feedback on this round. If this round is the final plan, say so in chat, and name "offer": "plan" in the next round's Agreed.`,
          }
        : {}),
    };
  }
  // Runs after the submission is saved, outside the browser's request, so a
  // slow or failing harness never delays the reviewer's Sent session.state.
  async function wakeAgent(round) {
    const line = `pair: the reviewer submitted round ${round} of session ${directory}. Run first: ${command("read")}. It prints the feedback and the next step.`;
    const last = await sendWake(line);
    await transition({ wake: { harness: session.wake.harness, last } });
  }
  /* Closing a session from the browser. complete() refuses without an
     acceptance, so ending an abandoned session needs its own door. */
  async function dismiss() {
    await transition({ stage: "complete", dismissedAt: timestamp() });
    return { status: view() };
  }
  // Every command but pair status goes through this check, start included.
  // The first one from an agent the session was taken from fails with the
  // time of the takeover and removes the agent from formerHolders, so the
  // agent stops instead of publishing over its successor. After that, a
  // command other than start from any agent but the holder fails with the
  // line that says to take the session over with pair start if the user asks.
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
        `Another agent has been this session's holder since ${clock(session.state.holder.at)}. Stop working on it unless the user asks you to take it over with: ${command("start")}`,
        409,
      );
  }
  // pair read lists each thread with a reviewer message since the
  // submission before the one it prints, or since the latest submission
  // when none waits, and names the moment of the submission it prints.
  function readAnswer(event, before) {
    return {
      threads: session.threadsSince(before?.receivedAt),
      threadsSince: before?.payload.round ?? null,
      ...(event
        ? {
            event: session.withDrawingPaths(event),
            moment:
              event.payload.intent === "accept"
                ? `read-accept-${event.payload.action}`
                : "read-feedback",
            ...startRead(event),
          }
        : { event: null }),
    };
  }
  // A Start prints with the card it started, so the agent reads what the
  // card approves.
  function startRead(event) {
    if (event.payload.intent !== "start") return {};
    return {
      moment: `read-start-${event.payload.where}`,
      proposal: session
        .proposalItems()
        .find((card) => card.id === event.payload.proposal),
    };
  }
  const submissionBefore = (sequence = Infinity) =>
    session.events
      .filter((item) => item.sequence < sequence)
      .sort((a, b) => b.sequence - a.sequence)[0];
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
        ...readAnswer(event, submissionBefore(event.sequence)),
        next: await nextStep(),
      };
    }
    const [event] = await pending();
    const declined = await session.reportDeclined();
    if (!event)
      return {
        status: view(),
        ...readAnswer(null, submissionBefore()),
        declined,
        next: await nextStep(),
      };
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
      ...readAnswer(event, submissionBefore(event.sequence)),
      declined,
      next: await nextStep(),
    };
  }
  async function ack(data) {
    requireValue(
      data.note === undefined ||
        (typeof data.note === "string" && data.note.trim().length <= 80),
      "A progress note is text of at most 80 characters",
    );
    requireValue(
      data.page === undefined || Boolean(data.note?.trim()),
      "A note on a page takes its text with --note",
    );
    const [event] = await pending();
    await transition(
      data.page === undefined
        ? { ...report(data.note?.trim() || null), ...receive(event) }
        : {
            ...session.notePage(data.page, data.note.trim()),
            // A page note is a report for the round's time. The note under
            // the card's title stays, with the time it was sent.
            report: { ...session.state.report, at: timestamp() },
            ...receive(event),
          },
    );
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
    return { status: view(), next: await nextStep() };
  }
  async function complete() {
    requireValue(
      session.state.accepted,
      `Read the acceptance with ${command("read")} before pair complete.`,
      409,
    );
    const action = actionOf(session.state.accepted);
    if (action.after !== "complete")
      requireValue(
        false,
        `${action.label} keeps the session open, so pair complete refuses. ${await nextStep()}`,
        409,
      );
    await transition({ stage: "complete" });
    return { status: view(), next: await nextStep() };
  }
  // The actions an agent command sends, by the command that sends it.
  // Any agent may run pair status, and only the holder's output names a
  // next step.
  const actions = {
    status: async (data) => ({
      status: view(),
      ...(sameAgent(session.state.holder, data.agent)
        ? { next: await nextStep() }
        : {}),
    }),
    read: readFeedback,
    ack,
    progress: (data) => session.pageProgress(data),
    pause,
    publish: (data) => session.publishPage(data.html, data.source, data.pages),
    complete,
    reply: (data) => session.reply(data),
    propose: async (data) => ({
      sessionId: session.state.sessionId,
      proposal: await session.propose(data),
      ...(sameAgent(session.state.holder, data.agent)
        ? { next: await nextStep() }
        : {}),
    }),
    plan: async (data) => ({
      sessionId: session.state.sessionId,
      ...(await session.attachPages(data)),
      ...(sameAgent(session.state.holder, data.agent)
        ? { next: await nextStep() }
        : {}),
    }),
  };
  async function act(data) {
    requireValue(
      data.sessionId === session.state.sessionId,
      "Wrong session",
      409,
    );
    // status only reads, so any agent, or none, may run it. Any agent may
    // record a proposal or attach a plan, such as a subagent that finds
    // work worth doing or writes the plan.
    if (!["status", "propose", "plan"].includes(data.action))
      await requireHolder(data.agent);
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
  // from a new conversation in the same Claude Code process. A start that
  // creates the session names it with its title and answers with the start
  // moment, and any other start answers with the session's next step.
  async function hold(target, options = {}) {
    const start = options.start === true;
    const { created } = options;
    const title = typeof options.title === "string" && options.title.trim();
    const agent = identify(target);
    const held = session.state.holder;
    const same = sameAgent(held, agent);
    // act() then answers or refuses the command, so a former holder's pair
    // status keeps its takeover notice.
    if (!start && held && !same) return {};
    const unread = (await pending()).length > 0;
    await requireHolder(agent, start);
    await atomic(session.wakeFile, target);
    session.wake = target;
    const patch = {
      wake: { harness: target.harness, last: session.state.wake?.last || null },
      paused: null,
      // The first Agreed's title replaces the one pair start gave.
      ...(created && title ? { title } : {}),
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
        roundStartedAt: timestamp(),
        wake: { harness: target.harness, last: null },
      });
    await transition(patch);
    // The bell of every pair tab announces the session pair start creates.
    if (start && !held && !session.state.current)
      await session.addActivity({
        kind: "session",
        agent: adapters[target.harness].name,
      });
    if (start && created) return { moment: "start", next: await nextStep() };
    const next = build ? await buildNext(unread) : start && (await nextStep());
    if (!next) return {};
    // An agent that takes the session over may never have read the core.
    return {
      next: same
        ? next
        : `Run pair guide first unless you have read it in this conversation. ${next}`,
    };
  }
  // The acceptance keeps its save action, so the line says outright that
  // this agent builds the plan.
  async function buildNext(unread) {
    const { round, offer } = session.state.current;
    const reading = unread
      ? command("read")
      : `${command("read")} --submission ${session.state.accepted.eventId}`;
    return `Round ${round} was saved for later, and you now build it. Run ${reading}, which prints the acceptance with the reviewer's comments, and its action stays ${actionAfter(offer, "saved").id}. Then build the plan as the ${actionAfter(offer, "round").label} section of ${offerGuide(offer)} describes.`;
  }
  return {
    handoff,
    report,
    nextStep,
    browserLine,
    sendWake,
    afterPublish,
    wakeAgent,
    dismiss,
    act,
    hold,
  };
}
