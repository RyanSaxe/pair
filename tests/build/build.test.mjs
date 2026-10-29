import "../support/env.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assemble } from "../../src/build/assemble.mjs";
import { problems } from "../../src/build/lint.mjs";
import { build, buildPage } from "../../src/cli/build.mjs";
import { pageData, readPlanData } from "../../src/shared/records.mjs";
import { exec, pair, root } from "../support/hub.mjs";

const data = {
  name: "t",
  round: "1",
  title: "T",
  pages: [{ id: "p", title: "P", html: "<p>x</p>" }],
};

// pageSource writes the page's CSS and JavaScript as files beside its source,
// as an author does, and builds the page.
async function pageSource({ cssText, jsText, ...page }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-page-"));
  try {
    const files = {};
    if (cssText !== undefined) {
      await fs.writeFile(path.join(directory, "page.css"), cssText);
      files.css = "page.css";
    }
    if (jsText !== undefined) {
      await fs.writeFile(path.join(directory, "page.mjs"), jsText);
      files.js = "page.mjs";
    }
    return await buildPage(path.join(directory, "page.json"), {
      name: "t",
      round: "1",
      title: "T",
      page: { id: "p", title: "P", html: "<p>x</p>", ...files, ...page },
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
const block = (css, prelude) => {
  const open = css.indexOf(`${prelude} {`) + prelude.length + 1;
  assert.ok(open > prelude.length, `no ${prelude} block`);
  for (let i = open + 1, depth = 1; i < css.length; i++) {
    depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    if (depth === 0) return css.slice(open + 1, i);
  }
  assert.fail(`${prelude} never closes`);
};
// carried returns the page's text followed by each decoded data: URL, so a
// check finds a file's text whether the build writes it inline or as a data:
// URL.
const carried = (html) =>
  [
    html,
    ...[...html.matchAll(/data:text\/javascript;base64,([\w+/=]+)/g)].map(
      ([, encoded]) => Buffer.from(encoded, "base64").toString("utf8"),
    ),
  ].join("\n");

// CSS ranks a later layer above an earlier one and an unlayered rule above
// both. A page rule inside the plan layer therefore loses to a component rule,
// and its @scope limits it to its own page and round.
test("page CSS reaches only its own page, below the component layer", async () => {
  const html = await pageSource({ cssText: "p{color:red}" });
  const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  assert.match(style, /^<style>\s*@layer frame, plan, components;/);
  const plan = block(style, "@layer plan");
  const scope = '@scope (#page-content[data-page-id="p"][data-round="1"])';
  assert.equal(block(plan, scope).trim(), "p{color:red}");
  assert.equal(style.split("p{color:red}").length, 2, "the rule appears once");
  assert.ok(block(block(style, "@scope (#page-content)"), "@layer components"));
});

test("every component's styles and behavior reach the page", async () => {
  const html = await assemble(data);
  const layer = block(
    block(html.slice(html.indexOf("<style>")), "@scope (#page-content)"),
    "@layer components",
  );
  const text = carried(html);
  const root = new URL("../../src/components/", import.meta.url);
  for (const name of await fs.readdir(root)) {
    const read = (file) =>
      fs.readFile(new URL(`${name}/${file}`, root), "utf8").catch(() => "");
    const [styles, behavior] = await Promise.all([
      read("styles.css"),
      read("behavior.mjs"),
    ]);
    if (styles.trim()) assert.ok(layer.includes(styles.trim()), name);
    if (!behavior.trim()) continue;
    assert.ok(behavior.includes(`planUI.define("${name}"`), name);
    assert.ok(text.includes(behavior.trim()), name);
  }
});

// The browser runs a page's script after the frame's modules, so planUI.define
// exists before the frame renders the first page.
test("a page's script is the last module in the document", async () => {
  const jsText = 'export function setup() { planUI.define("mine", {}); }';
  const html = await pageSource({ jsText });
  const modules = [
    ...html.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g),
  ].map(([, script]) => carried(script));
  assert.ok(modules.length >= 2, "the frame's modules and the page's");
  assert.ok(modules.at(-1).includes(jsText));
  assert.ok(modules.slice(0, -1).every((script) => !script.includes(jsText)));
});

// The hub builds every page of a round from the frame bundle stored with the
// round's Agreed. A round published before the frame had modules must still
// build with its one script.
test("a bundle stored before the frame's modules builds its one script", async () => {
  const parts = [
    "offers",
    "finish",
    "notifications",
    "choices",
    "draft",
    "activity",
    "script",
    "componentJs",
  ];
  const bundle = {
    shell:
      "<!doctype html><title>t</title><!-- FRAME_STYLE --><!-- DRAWING_EDITOR -->" +
      '<script type="application/json" id="plan-data">{}</script>' +
      "<!-- FRAME_SCRIPT --><!-- CUSTOM_SCRIPT -->",
    style: "",
    drawingEditor: "",
    componentCss: "",
    ...Object.fromEntries(parts.map((part) => [part, `/* ${part} */`])),
  };
  const html = await assemble(data, { bundle });
  assert.ok(!html.includes('<script type="importmap">'));
  const modules = html.split('<script type="module">').slice(1);
  assert.equal(modules.length, 2, "the frame's module and the plan's");
  assert.ok(
    modules[0].startsWith(
      `\n${parts.map((part) => `/* ${part} */`).join("\n")}\n</script>`,
    ),
  );
});

test("a closing style tag in page CSS is refused", async () => {
  await assert.rejects(
    pageSource({ cssText: "</style><script>1</script>" }),
    /closing style/,
  );
});

// The frame opens its Work page at #work, so the frame would never show a page
// with that ID.
test("a page whose ID names one of the frame's own pages is refused", async () => {
  await assert.rejects(
    pageSource({ id: "work", title: "Clearing Work" }),
    /Page ID "work" cannot be used\. .*agreed, feedback and work are reserved/,
  );
});

test("page JavaScript may read the frame's root elements but not change them", async () => {
  await assert.doesNotReject(
    pageSource({
      jsText:
        "export function setup() { return document.body.clientWidth > 900; }",
    }),
  );
  await assert.rejects(
    pageSource({
      jsText:
        "export function setup() {\n  document.body.style.color = 'red';\n}",
    }),
    /page\.js line 2 restyles document\.body/,
  );
});

// The frame imports the script as a module and calls the setup it exports, so a
// script that does not parse leaves the page with no behavior.
test("page JavaScript must parse and export setup, and the build never runs it", async () => {
  await assert.rejects(
    pageSource({
      jsText: "export function setup(root) {\n  const x = ;\n}",
    }),
    /page\.js line 2 does not parse: SyntaxError: Unexpected token ';'$/,
  );
  for (const jsText of [
    "throw new Error('ran');\nexport const setup = (root) => {};",
    "function setup(root) {}\nexport { setup };",
  ])
    await assert.doesNotReject(pageSource({ jsText }), jsText);
  await assert.rejects(
    pageSource({ jsText: "// export function setup(root) {}\nlet a = 1;" }),
    /Page JavaScript must export setup\(root, planUI\)/,
  );
});

const page = (html, extra = {}) => ({
  ...data,
  pages: [{ id: "p", title: "P", html }],
  ...extra,
});

const decision = (options) =>
  `<section data-choice="d" data-label="D">${options}</section>`;

const option = (value = "a") =>
  `<button data-value="${value}" data-label="${value}">${value}</button>`;

// pair build refuses a page for each problem that problems() lists, so these
// tests call problems() directly.
const refused = async (plan, message) =>
  assert.match(problems(plan).join("\n"), message);

test("an option label of exactly 24 characters is accepted", () => {
  const long = "x".repeat(24);
  assert.deepEqual(
    problems(
      page(
        decision(
          `<button data-value="a" data-label="${long}">a</button>${option("b")}`,
        ),
      ),
    ),
    [],
  );
});

// The builder refuses an h1, not a heading that repeats the title.
test("a page may repeat its title in a lower heading", async () => {
  await assert.doesNotReject(assemble(page("<h2>P</h2><p>x</p>")));
});

test("a group's label is not held to the option limit", () => {
  assert.deepEqual(
    problems(
      page(
        `<section data-choice="d" data-label="${"y".repeat(60)}">${option()}${option("b")}</section>`,
      ),
    ),
    [],
  );
});

test("the build refuses each structural problem and names it", async () => {
  await refused(
    { ...data, pages: [data.pages[0], data.pages[0]] },
    /^page "p" appears twice$/m,
  );
  await refused(
    page(decision(option() + option("b")) + decision(option() + option("b"))),
    /^page "p": control "d" appears twice$/m,
  );
  await refused(
    page(`<section data-choice="d">${option()}${option("b")}</section>`),
    /^page "p": control "d" has no data-label$/m,
  );
  await refused(
    page(
      decision(
        `<button data-value="a" data-label="${"x".repeat(25)}">a</button>${option("b")}`,
      ),
    ),
    /^page "p": option label "x{25}" is 25 characters, over 24$/m,
  );
  // A ">" inside a quoted attribute value does not end the tag, so the builder
  // still reads the whole label.
  await refused(
    page(
      decision(
        `<button data-value="a" data-label="Retry -> ${"x".repeat(16)}">a</button>${option("b")}`,
      ),
    ),
    /^page "p": option label "Retry -> x{16}" is 25 characters, over 24$/m,
  );
  await refused(
    page("<h1>P</h1><p>x</p>"),
    /^page "p": remove the h1, because the frame shows the page title as the page's only h1\. Start headings at h2\.$/m,
  );
  await refused(
    page(decision(option() + `<button data-value="">x</button>`)),
    /^page "p": an option in "d" has no data-value$/m,
  );
  await refused(
    page(decision(option())),
    /^page "p": decision "d" has 1 option\. Give it at least two\.$/m,
  );
  await refused(
    page(decision(option() + option())),
    /^page "p": options in "d" share data-value "a"\. Give each option in a group its own data-value\.$/m,
  );
  await refused(
    page(`<section data-question="q" data-label="Q"><h3>?</h3></section>`),
    /^page "p": question "q" has no textarea$/m,
  );
  await refused(
    page("<pre>x</pre>"),
    /^page "p": a code block has no data-language$/m,
  );
  await refused(
    page(`<div data-file="a.ts">x</div>`),
    /^page "p": a code block has no data-language$/m,
  );
  await refused(
    page(`<pre data-language="diff">- a\n+ b</pre>`),
    /^page "p": a code block marked diff belongs in before-after\. Run pair diff BEFORE AFTER OUT\.json$/m,
  );
  await refused(
    page(`<pre data-language="golang">x</pre>`),
    /^page "p": data-language "golang" is not a language Shiki highlights\. Did you mean "go"\?$/m,
  );
  await refused(
    page(`<pre data-language="Dockerfile">x</pre>`),
    /Did you mean "dockerfile"\?$/m,
  );
  await refused(
    page(`<pre data-language="zzz">x</pre>`),
    /^page "p": data-language "zzz" is not a language Shiki highlights\. Use a Shiki language ID, such as ts, python, shell or text\.$/m,
  );
  await refused(
    page(
      `<fieldset data-multiselect="s" data-label="S"><label><input type="checkbox" data-value="a" checked> A</label></fieldset>`,
    ),
    /^page "p": checklist "s" has a checked box\. Start every box unchecked\.$/m,
  );
  await refused(
    page(`<textarea data-diff-input hidden>{"before":""}</textarea>`),
    /^page "p": a diff input is not JSON with before, after and patch$/m,
  );
  await refused(
    page(`<a href="#nope">x</a>`),
    /^page "p": link "#nope" names no page of the round and no element on this page\. The round's pages are agreed and p\.$/m,
  );
  await refused(
    page(`<div data-prototype="ghost"></div>`),
    /^page "p": prototype "ghost" does not exist$/m,
  );
  for (const src of [
    "shot.png",
    "./a/shot.png",
    "/tmp/shot.png",
    "file:///tmp/shot.png",
  ])
    await refused(
      page(`<img src="${src}" alt="">`),
      new RegExp(
        `^page "p": img src "${src.replace(/[./]/g, "\\$&")}" is a file path, which the hub does not serve\\. Embed the image in src as a data: URI\\.$`,
        "m",
      ),
    );
  for (const value of ["3;7", "9-3", "0", "abc", ""])
    await refused(
      page(`<pre data-language="ts" data-lines="${value}">a\nb</pre>`),
      new RegExp(
        `^page "p": data-lines "${value}" is not a list of lines\\. Write lines and ranges counted from 1, such as "7", "3-4" or "3-4, 9"\\.$`,
        "m",
      ),
    );
  // The hub assembles every stored page again at each publish, so assemble()
  // must accept a page that an older pair build accepted.
  await assert.doesNotReject(assemble(page(`<img src="shot.png" alt="">`)));
  await refused(
    page(
      `<p>x</p>\n<pre data-language="ts" data-file="a.ts">\nfirst<T>(items)\nok\nif (a</b) {}\n</pre>`,
    ),
    /^page "p": the ts code block "a\.ts" has a < that the browser reads as a tag on lines 3 and 5 of the page's HTML, first at "<T>\(items\)"\. Write &lt; for each < in a code block or a diagram\.$/m,
  );
  await refused(
    page(`<div data-diagram>flowchart LR\n  A["x<br/>y"]</div>`),
    /^page "p": the diagram has a < that the browser reads as a tag on line 2 of the page's HTML, first at "<br\/>y"\]"\. Write &lt; for each < in a code block or a diagram\.$/m,
  );
  await refused(
    page(`<pre data-language="ts" data-lines="611-621">\na\nb\n</pre>`),
    /^page "p": data-lines "611-621" names line 621, and the block has 2 lines\. Count from the block's first line, and put the file's line numbers in data-caption\.$/m,
  );
});

// problems() matches a link's fragment as text, so a fragment with regular
// expression syntax neither throws nor matches another id.
test("a link names no page unless an id equals its fragment", () => {
  assert.deepEqual(
    problems(page('<a href="#x(">x</a><a href="#a.b">y</a><i id="aXb"></i>')),
    ["#x(", "#a.b"].map(
      (link) =>
        `page "p": link "${link}" names no page of the round and no element on this page. The round's pages are agreed and p.`,
    ),
  );
});

test("a checklist box is refused for the checked attribute, not for the word in a label", async () => {
  const checklist = (input) =>
    page(
      `<fieldset data-multiselect="s" data-label="S"><label>${input} A</label></fieldset>`,
    );
  assert.deepEqual(
    problems(
      checklist(
        '<input type="checkbox" data-value="a" data-label="Types checked by tsc">',
      ),
    ),
    [],
  );
  await refused(
    checklist('<input type="checkbox" data-value="a" data-label="A" checked>'),
    /^page "p": checklist "s" has a checked box\. Start every box unchecked\.$/m,
  );
});

// The frame finds an option's control with closest(), and the browser renders
// nothing inside an HTML comment.
test("an option counts for the nearest control around it, and a commented control is not one", () => {
  assert.deepEqual(
    problems(
      page(
        `<section data-choice="vd" data-label="V">` +
          `<article data-value="one" data-label="One">${decision(option() + option("b"))}</article>` +
          `<article data-value="two" data-label="Two">t</article></section>`,
      ),
    ),
    [],
  );
  assert.deepEqual(
    problems(page(`<p>x</p><!-- ${decision(option())} -->`)),
    [],
  );
});

test("well-formed controls, anchors and blocks pass", () => {
  const found = problems(
    page(
      decision(option() + option("b")) +
        `<section data-choice="arrow" data-label="Retry -> fail">${option()}${option("b")}</section>` +
        `<section data-question="q" data-label="Q"><textarea></textarea></section>` +
        `<div data-language="ts" data-file="a.ts">x</div><pre data-diff-source="before"></pre>` +
        `<pre data-language="ts" data-lines="1, 3-4">\na\nb\nc\nd\n</pre>` +
        `<pre data-language="ts">f&lt;T&gt;(a < b, a<=b, a <- b, 1<2)</pre>` +
        `<a href="#p">p</a><a href="#agreed">a</a><a href="#local">l</a><i id="local"></i>` +
        `<div data-prototype="demo"></div>` +
        `<textarea data-diff-input hidden>{"before":"a","after":"b","patch":"p"}</textarea>` +
        `<img src="data:image/png;base64,iVBORw0KGgo=" alt=""><img src="https://example.com/a.png" alt="">` +
        `<img src="http://example.com/a.png" alt=""><img src="//example.com/a.png" alt=""><img class="later" alt="">`,
      {
        prototypes: [
          { id: "demo", title: "Demo", html: "<p>d</p>", height: 100 },
        ],
      },
    ),
  );
  assert.deepEqual(found, []);
});

test("an Agreed page opens with a task, and the plan data carries it", async () => {
  const agreed = (page) =>
    buildPage(path.join(os.tmpdir(), "agreed.json"), {
      name: "t",
      round: "1",
      title: "T",
      page: { id: "agreed", title: "Agreed so far", agreements: [], ...page },
    });
  await assert.rejects(
    agreed({}),
    /page "agreed": Agreed has no task\. State what the plan is building towards\./,
  );
  await assert.rejects(
    agreed({ task: { title: " ", html: "<p>x</p>" } }),
    /page "agreed": the task has no title/,
  );
  const task = { title: "Retries", html: "<p>Checkout retries once.</p>" };
  const html = await agreed({ task });
  const data = JSON.parse(
    html
      .match(/id="plan-data">([\s\S]*?)<\/script>/)[1]
      .replaceAll("\\u003c", "<"),
  );
  assert.deepEqual(data.task, task);
});

test("a page source builds a standalone preview", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-build-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  // The frame draws the page title, so the page's own heading is an h2. The raw
  // </script> checks that the builder escapes it inside the script element that
  // contains the page's data.
  const content = "<h2>Interface</h2><p>literal </script> and $&</p>";
  await fs.writeFile(path.join(directory, "interface.html"), content);
  await fs.writeFile(
    path.join(directory, "custom.css"),
    ".prototype { color: var(--attention); }",
  );
  await fs.writeFile(
    path.join(directory, "custom.js"),
    'export function setup(root) { root.dataset.test = "ready"; }',
  );
  const source = path.join(directory, "source.json");
  await fs.writeFile(
    source,
    JSON.stringify({
      name: "build",
      round: "1",
      title: "Build",
      page: {
        id: "overview",
        title: "Overview",
        file: "interface.html",
        css: "custom.css",
        js: "custom.js",
      },
    }),
  );
  const html = await build(source);
  assert.equal(pageData(html).page.html, content);
  assert.equal(pageData(html).page.file, undefined);
  assert.equal(
    pageData(html).page.cssText,
    ".prototype { color: var(--attention); }",
  );
  assert.equal(
    pageData(html).page.jsText,
    'export function setup(root) { root.dataset.test = "ready"; }',
  );
  // The out/1 directories do not exist, so this run checks that pair build
  // creates them.
  const output = path.join(directory, "out", "1", "round.html");
  await exec(process.execPath, [pair, "build", source, output]);
  assert.equal(await fs.readFile(output, "utf8"), html);
  await assert.rejects(
    exec(process.execPath, [pair, "build", source, output]),
    /already exists, and pair never overwrites a file/,
  );

  // npm installs pair as a symlink to src/cli.mjs, so pair build must run
  // through a link.
  const link = path.join(directory, "pair");
  await fs.symlink(pair, link);
  const linked = path.join(directory, "linked.html");
  await exec(process.execPath, [link, "build", source, linked]);
  assert.equal(await fs.readFile(linked, "utf8"), html);
  await assert.rejects(exec(process.execPath, [link, "build"]), { code: 1 });
});

// A browser decodes &lt;, &gt; and &amp; inside a textarea. The decoded
// textarea matches the file's text only if pair build escaped it.
test("a diff input that names its JSON file builds with the file's exact text, and a missing or malformed file is refused", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-build-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const before = "<p>Fish &amp; chips &lt;3</p>\n";
  const after = "<p>Fish & chips</p>\n</textarea>\n";
  const text = `${JSON.stringify(
    {
      before,
      after,
      patch:
        "--- a/fish.html\n+++ b/fish.html\n@@ -1 +1,2 @@\n-<p>Fish &amp; chips &lt;3</p>\n+<p>Fish & chips</p>\n+</textarea>\n",
    },
    null,
    2,
  )}\n`;
  await fs.writeFile(path.join(directory, "fish.json"), text);
  await fs.writeFile(path.join(directory, "bad.json"), '{"before":"a"}');
  const withDiffs = (html) =>
    buildPage(path.join(directory, "page.json"), {
      name: "t",
      round: "1",
      title: "T",
      page: { id: "p", title: "P", html },
    });
  const pasted = '{"before":"a","after":"b","patch":""}';
  const built = pageData(
    await withDiffs(
      `<textarea data-diff-input="fish.json" hidden></textarea>` +
        `<textarea data-diff-input hidden>${pasted}</textarea>`,
    ),
  ).page.html.match(
    /^<textarea data-diff-input="fish\.json" hidden>([^<]*)<\/textarea><textarea data-diff-input hidden>([^<]*)<\/textarea>$/,
  );
  assert.ok(built, "the textareas are not as written");
  const decoded = built[1].replace(
    /&(lt|gt|amp);/g,
    (entity, name) => ({ lt: "<", gt: ">", amp: "&" })[name],
  );
  assert.equal(decoded, text);
  assert.equal(built[2], pasted);
  await assert.rejects(
    withDiffs(`<textarea data-diff-input="none.json"></textarea>`),
    {
      message: `data-diff-input names none.json, and ${path.join(directory, "none.json")} cannot be read. Write it with pair diff BEFORE AFTER ${path.join(directory, "none.json")}`,
    },
  );
  await assert.rejects(
    withDiffs(`<textarea data-diff-input="bad.json"></textarea>`),
    {
      message: `data-diff-input names bad.json, and ${path.join(directory, "bad.json")} is not JSON with before, after and patch strings. Name a file that pair diff BEFORE AFTER OUT.json wrote`,
    },
  );
  await assert.rejects(
    withDiffs(`<textarea data-diff-input="fish.json">${pasted}</textarea>`),
    {
      message:
        "data-diff-input names fish.json, and the textarea is not empty. Leave it empty.",
    },
  );
});

test("pair build lists a css or js file it cannot read with the page's other problems, and writes nothing", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-build-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source.json");
  await fs.writeFile(
    source,
    JSON.stringify({
      name: "build",
      round: "1",
      title: "Build",
      page: {
        id: "p",
        title: "P",
        html: "<h1>P</h1>",
        css: "page.css",
        js: "page.mjs",
      },
    }),
  );
  const output = path.join(directory, "out", "p.html");
  await assert.rejects(
    exec(process.execPath, [pair, "build", source, output]),
    ({ stderr }) => {
      assert.equal(
        stderr,
        [
          `pair: page "p": css names page.css, and pair build cannot read ${path.join(directory, "page.css")}. Write that file, or correct the path in css.`,
          `page "p": js names page.mjs, and pair build cannot read ${path.join(directory, "page.mjs")}. Write that file, or correct the path in js.`,
          `page "p": remove the h1, because the frame shows the page title as the page's only h1. Start headings at h2.`,
          "",
        ].join("\n"),
      );
      return true;
    },
  );
  await assert.rejects(fs.access(path.join(directory, "out")), {
    code: "ENOENT",
  });
});

test("an error from pair build starts with pair:", async () => {
  const missing = path.join(os.tmpdir(), "pair-no-such-dir", "source.json");
  await assert.rejects(
    exec(process.execPath, [pair, "build", missing, "out.html"]),
    ({ stderr }) => /^pair: ENOENT/.test(stderr),
  );
});

test("preserved prototypes retain exact executable source without escaping into the frame", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-prototype-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const html =
    '<!doctype html><button id="try">Try</button><script>document.querySelector("button").onclick = () => alert("$&");</script>';
  await fs.writeFile(path.join(directory, "prototype.html"), html);
  const data = {
    name: "example",
    round: "1",
    title: "Example work",
    page: {
      id: "overview",
      title: "Preview",
      html: '<div data-prototype="demo"></div><code>data-prototype="ID"</code>',
      prototypes: [
        {
          id: "demo",
          title: "Approved interaction",
          file: "prototype.html",
          height: 420,
        },
      ],
    },
  };
  const source = path.join(directory, "source.json");
  await fs.writeFile(source, JSON.stringify(data));
  const result = await build(source);
  const parsed = pageData(result);
  assert.equal(parsed.page.prototypes[0].html, html);
  assert.equal(parsed.page.prototypes[0].file, undefined);
  assert(!result.includes(html));
  for (const prototypes of [
    [],
    [null],
    [{ ...parsed.page.prototypes[0], height: 0 }],
    [{ ...parsed.page.prototypes[0], html: "" }],
    [parsed.page.prototypes[0], parsed.page.prototypes[0]],
  ])
    await assert.rejects(
      buildPage(source, { ...parsed, page: { ...parsed.page, prototypes } }),
    );
  await fs.writeFile(
    source,
    JSON.stringify({
      ...data,
      page: {
        ...data.page,
        prototypes: [{ ...data.page.prototypes[0], html }],
      },
    }),
  );
  await assert.rejects(build(source), /file.*html|html.*file/);
});

test("the component fixture builds", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-fixture-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "fixture.html");
  // assemble() refuses a page that breaks a build rule, so this test fails when
  // a fixture page breaks one.
  await exec(process.execPath, [
    path.join(root, "tests/fixture/build.mjs"),
    output,
  ]);
  const plan = readPlanData(await fs.readFile(output, "utf8"));
  assert.equal(plan.title, "Component fixture");
});
