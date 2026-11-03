import { session } from "#frame/app/view.mjs";
import { escapeHtml, HERE, KINDS } from "#frame/search/rows.mjs";

/* The menus above a list work alike. Each lists choices that combine, with All on
   top, and its button says what the list covers: a choice's name, or a count once
   there are several, so a button's label stays short. */
const LATEST = "latest";
const CLOSED = "closed";

export const menusHtml = (names) =>
  names
    .map(
      (name) => `
  <div class="search-menu-anchor" data-menu="${name}">
    <button class="btn search-filter search-menu-button" type="button" aria-expanded="false"><span></span></button>
    <div class="search-menu" role="group" aria-label="${name}" hidden></div>
  </div>`,
    )
    .join("");

/* items gives a menu's choices, and labels the button's words for one choice.
   counted names the menus whose choices show a count, which draw() takes by the
   choice's value. */
export function createMenus({
  host,
  state,
  names,
  items,
  labels,
  counted = [],
  allLabel = (name) => `All ${name}`,
  changed = (name) => state[name].length > 0,
  pressed = (name, value) => state[name].includes(value),
}) {
  const partOf = (name) => host.querySelector(`[data-menu="${name}"]`);
  const menuOf = (name) => partOf(name).querySelector(".search-menu");
  const buttonOf = (name) => partOf(name).querySelector(".search-menu-button");
  let opened = null;

  function label(name) {
    const chosen = state[name];
    if (!chosen.length) return allLabel(name);
    return chosen.length === 1
      ? labels[name](chosen)
      : `${chosen.length} ${name}`;
  }
  function fill(name, menu) {
    const list = items[name]();
    const key = JSON.stringify(list);
    if (menu.dataset.key === key) return;
    menu.dataset.key = key;
    const focused = opened === name && document.activeElement?.dataset.value;
    // The list can grow under the reader, so it stays where they had it.
    const top = menu.scrollTop;
    menu.innerHTML = list
      .map((item) =>
        item
          ? `<button class="search-menu-item" type="button" data-value="${escapeHtml(item[0])}"><span>${escapeHtml(item[1])}</span>${counted.includes(name) && item[0] ? "<b></b>" : ""}</button>`
          : '<div class="search-menu-rule"></div>',
      )
      .join("");
    menu.scrollTop = top;
    if (typeof focused === "string")
      menu
        .querySelector(`[data-value="${CSS.escape(focused)}"]`)
        ?.focus({ preventScroll: true });
  }
  function draw(counts = {}) {
    for (const name of names) {
      const menu = menuOf(name);
      fill(name, menu);
      const button = buttonOf(name);
      const text = label(name);
      button.firstElementChild.textContent = text;
      button.title = text;
      button.classList.toggle("is-set", changed(name));
      for (const item of menu.querySelectorAll("button")) {
        const { value } = item.dataset;
        item.setAttribute(
          "aria-pressed",
          String(value ? pressed(name, value) : !state[name].length),
        );
        const count = item.querySelector("b");
        if (!count) continue;
        count.textContent = counts[value] ?? 0;
        item.dataset.empty = String(!counts[value]);
      }
    }
  }
  return {
    names,
    draw,
    load: async () => {},
    opened: () => opened,
    // The keys move through the menu from the moment it opens.
    show(name) {
      opened = name;
      for (const each of names) {
        menuOf(each).hidden = each !== name;
        buttonOf(each).setAttribute("aria-expanded", String(each === name));
      }
      if (name) menuOf(name).querySelector("button").focus();
    },
    // From a menu, Tab moves on from the button that opened it.
    leave() {
      const button = opened && buttonOf(opened);
      this.show(null);
      button?.focus();
    },
    move(step) {
      const list = [...menuOf(opened).querySelectorAll("button")];
      const at = list.indexOf(document.activeElement);
      list[(at + step + list.length) % list.length].focus();
    },
    choose(name, value) {
      const chosen = state[name];
      state[name] = !value
        ? []
        : chosen.includes(value)
          ? chosen.filter((item) => item !== value)
          : [...chosen, value];
    },
  };
}

// Search's three menus: sessions, rounds and kinds.
export function searchMenus({ host, state }) {
  let sessions = [];
  const hereId = (value) => (value === HERE ? session.sessionId : value);
  // Round 7 means something different in each session, so round numbers show
  // only for one session.
  function roundNumbers() {
    if (state.sessions.length !== 1) return [];
    const id = hereId(state.sessions[0]);
    return sessions.find((item) => item.id === id)?.rounds ?? [];
  }
  const items = {
    sessions: () => [
      ["", "All sessions"],
      [HERE, "This session"],
      null,
      ...sessions
        .filter(
          ({ id, closed }) =>
            id !== session.sessionId && (state.closed || !closed),
        )
        .map(({ id, title }) => [id, title]),
      [CLOSED, "Include closed sessions"],
    ],
    rounds: () => [
      ["", "All rounds"],
      [LATEST, "Latest round"],
      ...(roundNumbers().length ? [null] : []),
      ...roundNumbers().map((round) => [round, `Round ${round}`]),
    ],
    kinds: () => [["", "All kinds"], ...KINDS],
  };
  const labels = {
    sessions: ([only]) =>
      only === HERE
        ? "This session"
        : (sessions.find(({ id }) => id === only)?.title ?? "1 session"),
    rounds: ([only]) => (only === LATEST ? "Latest round" : `Round ${only}`),
    kinds: ([only]) => KINDS.find(([id]) => id === only)?.[1],
  };
  const onlyHere = () =>
    state.sessions.length === 1 && state.sessions[0] === HERE;
  const menus = createMenus({
    host,
    state,
    names: ["sessions", "rounds", "kinds"],
    items,
    labels,
    counted: ["kinds"],
    allLabel: (name) =>
      name === "sessions" && state.closed ? "All + closed" : `All ${name}`,
    changed: (name) =>
      name === "sessions"
        ? state.closed || !onlyHere()
        : state[name].length > 0,
    pressed: (name, value) =>
      value === CLOSED ? state.closed : state[name].includes(value),
  });
  // A round number belongs to the session it was chosen in.
  const keepLatest = () => {
    state.rounds = state.rounds.filter((round) => round === LATEST);
  };

  // Closed sessions are for a wider search, so asking for them leaves this
  // session. Closing the list drops any closed session chosen from it.
  function switchClosed() {
    state.closed = !state.closed;
    if (state.closed && onlyHere()) state.sessions = [];
    if (!state.closed)
      state.sessions = state.sessions.filter(
        (id) => !sessions.find((item) => item.id === id)?.closed,
      );
    keepLatest();
  }
  const choose = menus.choose;

  return {
    ...menus,
    async load() {
      try {
        const reply = await fetch("/api/search/sessions");
        if (reply.ok) ({ sessions } = await reply.json());
      } catch {
        // Without the list, the menus still offer this session and all of them.
      }
    },
    choose(name, value) {
      if (value === CLOSED) return switchClosed();
      choose(name, value);
      if (name === "sessions") keepLatest();
    },
    // The keys switch between the first two choices of a menu.
    switchSessions() {
      state.sessions = onlyHere() ? [] : [HERE];
      keepLatest();
    },
    switchRounds() {
      state.rounds = state.rounds.length ? [] : [LATEST];
    },
    sessionIds: () => state.sessions.map(hereId).join(","),
  };
}
