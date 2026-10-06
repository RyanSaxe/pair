import path from "node:path";
import { idPattern } from "../../shared/records.mjs";
import { atomic, read, requireValue, timestamp } from "../../shared/util.mjs";
import { adapters, identify, wakeRunner } from "../wake.mjs";
import { nextOf } from "./submissions.mjs";

// Only the reviewer's feedback answers a round. A Start leaves the round as
// it was, wherever its work runs.
export const answersRound = (event) => event.payload.intent !== "start";
const sameAgent = (a, b) => a?.harness === b?.harness && a?.id === b?.id;
// The agent's commands, the holder, and the lines that tell the agent what
// to do next.
export function agent(session) {
  const { directory, config, transition, pending, view } = session;
  const command = (name) => `pair ${name} --session-dir ${directory}`;
  const closed = "The reviewer closed this session. Stop working on it.";
  // Any agent in any harness takes the session over with this line.
  const handoff = `To take over pair session ${directory}, run ${command("start")} and follow what it prints.`;
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
  // The proposals started here that are not done, whose work goes on until
  // the agent marks it done.
  const startedHere = () =>
    session
      .proposalItems()
      .filter((card) => card.started?.where === "here" && !card.done);
  // Every agent command prints the step after it, so an agent that lost its
  // place is told where the session stands.
  async function nextStep() {
    if (session.state.stage === "complete") return closed;
    const [event] = await pending();
    if (event) return `Run ${command("read")} to see what the reviewer sent.`;
    if (session.state.paused)
      return `You paused this session. Tell the reviewer, and when they ask you to continue, run ${command("start")}.`;
    if (!session.state.current)
      return "Publish Agreed with round 1's page list, using pair publish, within a few minutes and before you research or write any other page.";
    if (session.state.openRound) {
      const left = session.state.openRound.pages
        .filter((slot) => !slot.recordPath)
        .map((slot) =>
          slot.state === "active" ? `${slot.id} (started)` : slot.id,
        );
      return `You still have to publish these pages: ${left.join(", ")}. When you begin a page, and at least every five minutes while you or a subagent work on it, run pair progress --page ID --note "…". Publish each page with pair publish as soon as pair build has built it.`;
    }
    if (session.state.stage === "working")
      return "Edit Agreed's task and alignments to match this feedback. Then publish Agreed with the round's page list, using pair publish, within a few minutes and before you research or write any other page.";
    const { round } = session.state.current;
    // Work started here after this round's page list was published has no
    // page in it, so the agent builds it now for the next round.
    const ids = startedHere()
      .filter((card) => card.started.round === round)
      .map((card) => card.id);
    if (session.needsYou() && ids.length) {
      const named =
        ids.length === 1
          ? `proposal ${ids[0]}`
          : `proposals ${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
      const its = ids.length === 1 ? "its" : "their";
      return `You published round ${round}, and the reviewer has not sent feedback on it yet. If you have not told the reviewer in the chat what changed, tell them now. Then build ${named}, which the reviewer approved for this session, and end your turn when you have done what you can. Update ${its} status each time you finish a part. When the reviewer sends feedback, the hub wakes you, and you publish the pages about this work in the next round.`;
    }
    return `You published round ${round}. If you have not told the reviewer in the chat what changed, tell them, then end your turn. The hub wakes you when the reviewer sends feedback.`;
  }
  // The first Agreed of a session says whether to open its URL. A pair tab
  // that polled the hub recently lists the new session in its bell and
  // session list, so the agent opens a second tab only when none did.
  const browserLine = (url) =>
    session.tabOpen()
      ? `The reviewer already has pair open in their browser. Give them the link ${url} in the chat, and do not open another tab.`
      : `Open ${url} in the reviewer's default browser (macOS open, Windows Start-Process, Linux xdg-open, with the URL quoted), and give them the link in the chat.`;
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
  // Runs after the submission is saved, outside the browser's request, so a
  // slow or failing harness never delays the reviewer's Sent session.state.
  async function wakeAgent(round) {
    const line = `pair: the reviewer sent feedback on round ${round} of session ${directory}. Run ${command("read")} first, which prints the feedback and your next step.`;
    const last = await sendWake(line);
    await transition({ wake: { harness: session.wake.harness, last } });
  }
  // The reviewer closes a session from the browser. The hub sends the agent
  // nothing, and refuses the agent's next command with the line that says
  // the session is complete. Closing deletes no file, and the agent removes
  // its scratch worktrees once the reviewer agrees.
  async function close() {
    await transition({ stage: "complete", dismissedAt: timestamp() });
    await session.closeLinked();
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
        `Another agent has run this session since ${clock(session.state.holder.at)}, so stop working on it. If the reviewer asks you to take it over, run ${command("start")}.`,
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
        ? { event: session.withDrawingPaths(event), ...eventRead(event) }
        : { event: null }),
    };
  }
  // The reviewer's choice for the next round names a moment, except Keep
  // iterating, which asks for nothing new. Iterate on a plan round is Back
  // to iterating.
  function choiceMoment(payload) {
    const next = nextOf(payload);
    if (next !== "iterate") return `read-${next}`;
    return session.roundEntry(payload.round)?.plan ? "read-iterate" : null;
  }
  // A Start prints with the card it started, so the agent reads what the
  // card approves. Feedback prints with every card started here that is not
  // done, so the agent keeps building that work in the round the feedback
  // begins.
  function eventRead(event) {
    if (event.payload.intent !== "start")
      return {
        moment: ["read-feedback", choiceMoment(event.payload)].filter(Boolean),
        running: startedHere(),
      };
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
      requireValue(
        idPattern.test(data.id || "") &&
          session.events.some((item) => item.id === data.id),
        `This session has no submission ${data.id}. Give --submission the ID of a submission that pair read printed.`,
        404,
      );
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
    const closed = await session.reportClosed();
    if (!event)
      return {
        status: view(),
        ...readAnswer(null, submissionBefore()),
        declined,
        closed,
        next: await nextStep(),
      };
    const patch = {
      ...report(),
      ...receive(event),
      stage: !answersRound(event) ? session.state.stage : "working",
      acknowledged: [...session.state.acknowledged, event.id],
      acknowledgedAt: timestamp(),
      lastAcknowledgedId: event.id,
    };
    await transition(patch);
    const { proposal, where } = event.payload;
    return {
      status: view(),
      ...readAnswer(event, submissionBefore(event.sequence)),
      declined,
      closed,
      // A sub-session's Start leaves this session's round as it was, so its
      // next step is the command that creates the sub-session.
      next:
        where === "sub-session"
          ? `Run pair start --from ${directory} --proposal ${proposal}, then follow what it prints.`
          : await nextStep(),
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
    reply: (data) => session.reply(data),
    // Work started with a new agent on the reviewer's words waits for an
    // agent that runs pair start --from, as after Open a new agent session.
    propose: async (data) => {
      const holder = sameAgent(session.state.holder, data.agent);
      const proposal = await session.propose(data, holder);
      // A status from a linked session goes to the card in its parent.
      const parent = session.cardOwner(proposal.id, "pair propose");
      const next =
        data.start === "new-agent"
          ? `Open a new agent session and have it run pair start --from ${directory} --proposal ${proposal.id} first. If you cannot open one, give the reviewer that command in the chat. Then go back to what you were doing.`
          : await nextStep();
      return {
        sessionId: session.state.sessionId,
        proposal,
        ...(parent ? { parent: { id: parent.id, title: parent.title() } } : {}),
        ...(holder ? { next } : {}),
      };
    },
  };
  async function act(data) {
    requireValue(
      data.sessionId === session.state.sessionId,
      "Wrong session",
      409,
    );
    // status only reads, so any agent, or none, may run it, on a closed
    // session too. Any agent may record a proposal, such as a subagent that
    // finds work worth doing.
    if (data.action !== "status") {
      requireValue(session.state.stage !== "complete", closed, 409);
      if (data.action !== "propose") await requireHolder(data.agent);
    }
    requireValue(Object.hasOwn(actions, data.action), "Unknown agent action");
    return actions[data.action](data);
  }
  // pair start makes its agent the holder, the one agent the hub wakes. Any
  // other registration, such as a command reattaching to a new hub, changes
  // nothing when it comes from an agent other than the holder. A start that
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
    await transition(patch);
    // The bell of every pair tab announces the session pair start creates.
    if (start && !held && !session.state.current)
      await session.addActivity({
        kind: "session",
        agent: adapters[target.harness].name,
      });
    if (start && created)
      return {
        // A session pair start --from created runs one proposal.
        moment: session.state.parent
          ? ["start", session.plansFirst() ? "start-from-plan" : "start-from"]
          : "start",
        next: await nextStep(),
      };
    const next = start && (await nextStep());
    if (!next) return {};
    // An agent that takes the session over may never have read the core.
    return {
      next: same
        ? next
        : `If you have not run pair guide in this conversation, run it first. ${next}`,
    };
  }
  return {
    handoff,
    report,
    nextStep,
    browserLine,
    sendWake,
    wakeAgent,
    close,
    act,
    hold,
  };
}
