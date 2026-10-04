// Lays the screenshots out on a sheet and screenshots the sheet at 2x.
// Both sheets share one grid: 1280 CSS pixels wide with 48 of margin.
import path from "node:path";

const uri = (png) => `data:image/png;base64,${png.toString("base64")}`;
const esc = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// --- The terminal, drawn from what the staging's pair commands printed. ---

const uuid =
  /\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
// IDs keep their first eight characters, and "…" marks the rest.
const short = (text) => text.replace(uuid, "$1…");
// A command as typed, with the session directory cut to its ID and, for
// propose, the flags after --title left out behind "…".
function typed(args) {
  const parts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session-dir") {
      parts.push(args[i], `…/${path.basename(args[++i]).slice(0, 8)}`);
    } else if (args[0] === "propose" && args[i] === "--delivers") {
      parts.push("…");
      break;
    } else parts.push(/[\s,]/.test(args[i]) ? `"${args[i]}"` : short(args[i]));
  }
  return `pair ${parts.join(" ")}`;
}
function terminal(transcript) {
  const last = (what, test) => {
    const entry = transcript.findLast(test);
    if (!entry) throw new Error(`The staging ran no ${what}`);
    return entry;
  };
  const pick = (entry, pattern) => {
    const match = entry.text.match(pattern);
    if (!match) throw new Error(`pair ${entry.args[0]} printed no ${pattern}`);
    return match[0];
  };
  const publish = last("publish of where-to-retry", ({ args }) =>
    args.includes("out/2/where-to-retry.html"),
  );
  const reply = last("reply", ({ args }) => args[0] === "reply");
  const propose = last("propose", ({ args }) => args[0] === "propose");
  const read = last(
    "read of round 2",
    ({ args, text }) =>
      args[0] === "read" && /<pair_feedback [^>]*round="2"/.test(text),
  );
  return [
    [publish, [pick(publish, /^Published .*$/m)]],
    [reply, [pick(reply, /^Posted your reply.*$/m)]],
    [propose, [pick(propose, /^Proposal .*$/m)]],
    [
      read,
      pick(read, /^<pair_feedback[\s\S]*?^<\/pair_feedback>$/m).split("\n"),
    ],
  ].map(([entry, lines]) => ({
    cmd: typed(entry.args),
    out: lines.map(short),
  }));
}
// A line as words that never break inside, so it wraps only at a space,
// with each piece colored: pair's tags, their attributes and plain text.
function words(segments) {
  const all = [];
  let word = [];
  for (const [text, cls] of segments)
    for (const [i, part] of text.split(" ").entries()) {
      if (i > 0) {
        all.push(word);
        word = [];
      }
      if (part) word.push([part, cls]);
    }
  all.push(word);
  return all
    .filter((w) => w.length)
    .map(
      (w) =>
        `<span class="w">${w.map(([t, c]) => `<span class="${c}">${esc(t)}</span>`).join("")}</span>`,
    )
    .join(" ");
}
function tagged(line) {
  const segments = [];
  let at = 0;
  for (const m of line.matchAll(/(<\/?pair_[a-z]+)([^>]*)(>)/g)) {
    if (m.index > at) segments.push([line.slice(at, m.index), "o"]);
    segments.push([m[1], "tg"], [m[2], "at"], [m[3], "tg"]);
    at = m.index + m[0].length;
  }
  if (at < line.length) segments.push([line.slice(at), "o"]);
  return segments;
}
function termHtml(transcript) {
  const rows = [];
  for (const { cmd, out } of terminal(transcript)) {
    rows.push(
      `<div class="l">${words([
        ["$", "ps"],
        [` ${cmd}`, "cm"],
      ])}</div>`,
    );
    for (const line of out)
      rows.push(`<div class="l">${words(tagged(line))}</div>`);
    rows.push(`<div class="l">&nbsp;</div>`);
  }
  rows.push(
    `<div class="l"><span class="ps">$</span> <span class="cur"></span></div>`,
  );
  return rows.join("");
}

// --- Shared look. ---

function tokens(theme) {
  const dark = theme === "dark";
  return `:root{
  --canvas:${dark ? "#0b0d10" : "#f3f4f6"};
  --ink:${dark ? "#c9ced6" : "#3d424a"};
  --accent:${dark ? "#8fa5ff" : "#3457d5"};
  --win-edge:${dark ? "rgba(255,255,255,.13)" : "rgba(0,0,0,.14)"};
  --shadow:${dark ? "0 1px 2px rgba(0,0,0,.5), 0 12px 32px rgba(0,0,0,.45)" : "0 1px 2px rgba(0,0,0,.06), 0 12px 32px rgba(17,24,39,.12)"};
  --bar:${dark ? "#26282c" : "#ebebee"};
  --bar-line:${dark ? "#36383d" : "#d9d9de"};
  --url:${dark ? "#1b1d20" : "#ffffff"};
  --url-ink:${dark ? "#a7adb6" : "#5b6068"};
}
*{box-sizing:border-box;margin:0}
html,body{background:var(--canvas)}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased}
.canvas{display:grid;padding:48px;width:1280px}
.win{border-radius:10px;overflow:hidden;box-shadow:0 0 0 .5px var(--win-edge),var(--shadow);position:relative}
.dots{display:flex;gap:8px}
.dots i{width:12px;height:12px;border-radius:50%;display:block;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.12)}
.dots i:nth-child(1){background:#ff5f57}.dots i:nth-child(2){background:#febc2e}.dots i:nth-child(3){background:#28c840}
.arrow{position:absolute;left:12px;width:120px;height:0}
.arrow .ar{position:absolute;left:0;top:-6px;overflow:visible}
.arrow .lab{position:absolute;left:-12px;width:144px;text-align:center;font-size:13px;line-height:16px;color:var(--ink);font-weight:500}
.arrow .up{bottom:10px}.arrow .down{top:10px}
.ln{stroke:var(--ink);stroke-width:1.5;fill:none}.hd{fill:var(--ink)}
.thr .ln{stroke:var(--accent);stroke-dasharray:5 4}.thr .hd{fill:var(--accent)}.thr .lab{color:var(--accent)}`;
}
const arrow = (
  dir,
) => `<svg class="ar" viewBox="0 0 120 12" width="120" height="12" aria-hidden="true">
  ${
    dir === "both"
      ? `<path d="M7 6 H113" class="ln"/><path d="M1 6 L9 1.5 L9 10.5 Z" class="hd"/><path d="M119 6 L111 1.5 L111 10.5 Z" class="hd"/>`
      : dir === "right"
        ? `<path d="M0 6 H113" class="ln"/><path d="M119 6 L111 1.5 L111 10.5 Z" class="hd"/>`
        : `<path d="M7 6 H120" class="ln"/><path d="M1 6 L9 1.5 L9 10.5 Z" class="hd"/>`
  }</svg>`;

async function render(browser, html, check) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 2,
  });
  await page.setContent(html);
  await page.waitForLoadState("load");
  if (check) await check(page);
  const png = await page.screenshot({
    clip: await page.locator("#c").boundingBox(),
    animations: "disabled",
  });
  await page.close();
  return png;
}

// --- The illustration: terminal ⇄ browser, and the card that starts work. ---

export function composeIllustration(
  browser,
  theme,
  shot,
  transcript,
  geometry,
) {
  const browserWidth = 592;
  const scale = browserWidth / 880;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${tokens(theme)}
.canvas{grid-template-columns:448px 144px 592px;row-gap:40px}
.term{grid-column:1;grid-row:1;background:#16181c;display:flex;flex-direction:column;contain:size}
.term .bar{height:32px;flex:none;display:flex;align-items:center;padding:0 12px;background:#202227;border-bottom:1px solid #2c2f35}
.term .body{font-family:"SF Mono",SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;color:#d6dbe1;padding:12px 16px;flex:1;min-height:0;overflow:hidden}
.term .l{padding-left:2ch;text-indent:-2ch}
.term .w{white-space:pre}
.term .ps{color:#6fcf8f}.term .cm{color:#f2f4f7}.term .o{color:#aab2bd}
.term .tg{color:#7aa7e6}.term .at{color:#8a93a0}
.term .cur{display:inline-block;width:7px;height:14px;background:#d6dbe1;vertical-align:-2px;opacity:.85}
.browser{grid-column:3;grid-row:1;background:var(--bar)}
.browser .bar{height:36px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 12px;border-bottom:1px solid var(--bar-line)}
.browser .url{width:256px;height:24px;border-radius:6px;background:var(--url);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--url-ink);letter-spacing:.01em;box-shadow:0 0 0 .5px var(--bar-line)}
.browser img{display:block;width:592px;height:auto}
.arrows{grid-column:2;grid-row:1;position:relative}
.p1{top:calc(50% - 96px)}.p2{top:50%}.p3{top:calc(50% + 96px)}
.work{grid-column:3;grid-row:2;display:flex;align-items:flex-end;justify-content:space-between}
.card{width:${geometry.cardWidth * scale}px;border-radius:${12 * scale}px;box-shadow:var(--shadow);overflow:hidden}
.card img{display:block;width:100%;height:auto}
.start-arrow{flex:1;align-self:stretch;position:relative}
.sub{width:184px;background:var(--bar)}
.sub .bar{height:18px;display:flex;align-items:center;padding:0 7px;border-bottom:1px solid var(--bar-line)}
.sub .dots{gap:4px}.sub .dots i{width:6px;height:6px}
.sub .shot{height:${(184 * 380) / 880}px;overflow:hidden}
.sub .shot img{display:block;width:184px;height:auto}
</style></head><body><div class="canvas" id="c">
<div class="win term"><div class="bar"><div class="dots"><i></i><i></i><i></i></div></div><div class="body">${termHtml(transcript)}</div></div>
<div class="arrows">
  <div class="arrow p1">${arrow("right")}<div class="lab up">pages</div></div>
  <div class="arrow thr p2">${arrow("both")}<div class="lab up">a thread</div><div class="lab down">answered now</div></div>
  <div class="arrow p3">${arrow("left")}<div class="lab up">feedback</div></div>
</div>
<div class="win browser"><div class="bar"><div class="dots"><i></i><i></i><i></i></div><div class="url">127.0.0.1:4747</div><div></div></div><img src="${uri(shot.browser)}"></div>
<div class="work">
  <div class="card" id="card"><img src="${uri(shot.card)}"></div>
  <div class="start-arrow" id="sa"></div>
  <div class="win sub"><div class="bar"><div class="dots"><i></i><i></i><i></i></div></div><div class="shot"><img src="${uri(shot.sub)}"></div></div>
</div>
</div></body></html>`;
  return render(browser, html, async (page) => {
    // Unattended runs must not ship a clipped terminal or a broken word.
    const fit = await page.evaluate(() => {
      const body = document.querySelector(".term .body");
      const right = body.getBoundingClientRect().right - 16;
      const wide = [...body.querySelectorAll(".w")].filter(
        (w) => w.getBoundingClientRect().right > right + 0.5,
      );
      return {
        over: body.scrollHeight - body.clientHeight,
        wide: wide.map((w) => w.textContent),
      };
    });
    if (fit.over > 0)
      throw new Error(
        `The terminal's text is ${fit.over}px taller than the window`,
      );
    if (fit.wide.length)
      throw new Error(
        `Terminal words wider than a line: ${fit.wide.join(", ")}`,
      );
    // The Start arrow runs from the card's Start button to the sub-session.
    await page.evaluate((startY) => {
      const card = document.getElementById("card").getBoundingClientRect();
      const sa = document.getElementById("sa");
      const box = sa.getBoundingClientRect();
      const y = card.top + startY * card.height - box.top;
      const w = box.width;
      sa.innerHTML = `<svg style="position:absolute;left:0;top:${y - 6}px;overflow:visible" width="${w}" height="12" viewBox="0 0 ${w} 12"><path d="M12 6 H${w - 14}" class="ln"/><path d="M${w - 8} 6 L${w - 16} 1.5 L${w - 16} 10.5 Z" class="hd"/></svg>`;
    }, geometry.startY);
  });
}

// --- Work on a phone: the card, the Start popup, the sub-session. ---

export function composeWork(browser, theme, shot) {
  const phone = 320;
  const gap = (1184 - 3 * phone) / 2;
  const between = (label) =>
    `<div class="arrows"><div class="arrow" style="left:${(gap - 120) / 2}px;top:50%">${arrow("right")}<div class="lab up">${label}</div></div></div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${tokens(theme)}
.canvas{grid-template-columns:${phone}px ${gap}px ${phone}px ${gap}px ${phone}px}
.phone{border-radius:28px;overflow:hidden;box-shadow:0 0 0 .5px var(--win-edge),var(--shadow)}
.phone img{display:block;width:${phone}px;height:auto}
.arrows{position:relative}
.arrow .lab{left:-12px}
</style></head><body><div class="canvas" id="c">
<div class="phone"><img src="${uri(shot.phoneWork)}"></div>
${between("Start")}
<div class="phone"><img src="${uri(shot.phoneStart)}"></div>
${between("agent starts it")}
<div class="phone"><img src="${uri(shot.phoneSub)}"></div>
</div></body></html>`;
  return render(browser, html);
}
