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
import { exec, pair, root, task } from "../support/hub.mjs";

const data = {
  name: "t",
  round: "1",
  title: "T",
  pages: [{ id: "p", title: "P", html: "<p>x</p>" }],
};

const pageSource = (page) =>
  buildPage(path.join(os.tmpdir(), "page.json"), {
    name: "t",
    round: "1",
    title: "T",
    page: { id: "p", title: "P", html: "<p>x</p>", ...page },
  });
// The text inside the block that opens with `prelude {`, found by counting
// braces from its opening one.
const block = (css, prelude) => {
  const open = css.indexOf(`${prelude} {`) + prelude.length + 1;
  assert.ok(open > prelude.length, `no ${prelude} block`);
  for (let i = open + 1, depth = 1; i < css.length; i++) {
    depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    if (depth === 0) return css.slice(open + 1, i);
  }
  assert.fail(`${prelude} never closes`);
};
// The page's text with each data: URL decoded, so a check finds a file
// whether the build writes it inline or encodes it.
const carried = (html) =>
  [
    html,
    ...[...html.matchAll(/data:text\/javascript;base64,([\w+/=]+)/g)].map(
      ([, encoded]) => Buffer.from(encoded, "base64").toString("utf8"),
    ),
  ].join("\n");

// The cascade ranks a later layer above an earlier one and an unlayered rule
// above both, so a page rule inside the plan layer loses to a component rule,
// and its scope limits it to its own page and round.
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

// A page's script runs after the frame's modules, so planUI.define is
// available to it before the first page renders.
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

// A round builds every page from the bundle stored with its Agreed, so a
// round published before the frame's modules existed keeps its frame.
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

test("the build refuses an offer the registry does not define", async () => {
  await assert.rejects(
    buildPage(path.join(os.tmpdir(), "page.json"), {
      name: "t",
      round: "1",
      offer: "ship",
      title: "T",
      page: { id: "agreed", title: "Agreed", agreements: [], task },
    }),
    /Unknown offer "ship"\. The offers are plan, finish\./,
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

const page = (html, extra = {}) => ({
  ...data,
  pages: [{ id: "p", title: "P", html }],
  ...extra,
});

const decision = (options) =>
  `<section data-choice="d" data-label="D">${options}</section>`;

const option = (value = "a") =>
  `<button data-value="${value}" data-label="${value}">${value}</button>`;

const refused = (plan, message) =>
  assert.rejects(assemble(plan), (error) => {
    assert.match(error.message, message);
    return true;
  });

test("an option label of exactly 24 characters is accepted", async () => {
  const long = "x".repeat(24);
  const html = await assemble(
    page(
      decision(
        `<button data-value="a" data-label="${long}">a</button>${option("b")}`,
      ),
    ),
  );
  assert.match(html, /x{24}/);
});

// The rule is "no h1", not "no repeated words".
test("a page may repeat its title in a lower heading", async () => {
  await assert.doesNotReject(assemble(page("<h2>P</h2><p>x</p>")));
});

test("a group's label is not held to the option limit", async () => {
  const html = await assemble(
    page(
      `<section data-choice="d" data-label="${"y".repeat(60)}">${option()}${option("b")}</section>`,
    ),
  );
  assert.match(html, /y{60}/);
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
  await refused(
    page("<h1>P</h1><p>x</p>"),
    /^page "p": the frame draws the page title, so a page has no h1$/m,
  );
  await refused(
    page(decision(option() + `<button data-value="">x</button>`)),
    /^page "p": an option in "d" has no data-value$/m,
  );
  await refused(
    page(decision(option())),
    /^page "p": decision "d" has 1 option$/m,
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
    /^page "p": link "#nope" names no page$/m,
  );
  await refused(
    page(`<div data-prototype="ghost"></div>`),
    /^page "p": prototype "ghost" does not exist$/m,
  );
  for (const value of ["3;7", "9-3", "0", "abc", ""])
    await refused(
      page(`<pre data-language="ts" data-lines="${value}">a\nb</pre>`),
      new RegExp(
        `^page "p": data-lines "${value}" is not a list of lines\\. Write lines and ranges counted from 1, such as "7", "3-4" or "3-4, 9"\\.$`,
        "m",
      ),
    );
  await refused(
    page(`<pre data-language="ts" data-lines="611-621">\na\nb\n</pre>`),
    /^page "p": data-lines "611-621" names line 621, and the block has 2 lines\. Count from the block's first line, and put the file's line numbers in data-caption\.$/m,
  );
});

// A fragment is matched as text, so one with regular expression syntax in it
// neither throws nor matches another id.
test("a link names no page unless an id equals its fragment", () => {
  assert.deepEqual(
    problems(page('<a href="#x(">x</a><a href="#a.b">y</a><i id="aXb"></i>')),
    [
      'page "p": link "#x(" names no page',
      'page "p": link "#a.b" names no page',
    ],
  );
});

test("a checklist box is refused for the checked attribute, not for the word in a label", async () => {
  const checklist = (input) =>
    page(
      `<fieldset data-multiselect="s" data-label="S"><label>${input} A</label></fieldset>`,
    );
  await assert.doesNotReject(
    assemble(
      checklist(
        '<input type="checkbox" data-value="a" data-label="Types checked by tsc">',
      ),
    ),
  );
  await refused(
    checklist('<input type="checkbox" data-value="a" data-label="A" checked>'),
    /^page "p": checklist "s" has a checked box\. Start every box unchecked\.$/m,
  );
});

test("well-formed controls, anchors and blocks pass", async () => {
  const html = await assemble(
    page(
      decision(option() + option("b")) +
        `<section data-question="q" data-label="Q"><textarea></textarea></section>` +
        `<div data-language="ts" data-file="a.ts">x</div><pre data-diff-source="before"></pre>` +
        `<pre data-language="ts" data-lines="1, 3-4">\na\nb\nc\nd\n</pre>` +
        `<a href="#p">p</a><a href="#agreed">a</a><a href="#local">l</a><i id="local"></i>` +
        `<div data-prototype="demo"></div>` +
        `<textarea data-diff-input hidden>{"before":"a","after":"b","patch":"p"}</textarea>`,
      {
        prototypes: [
          { id: "demo", title: "Demo", html: "<p>d</p>", height: 100 },
        ],
      },
    ),
  );
  assert.match(html, /id="plan-data"/);
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
  // The frame draws the page title, so the page's own heading is an h2.
  const content =
    '<h2>Interface</h2><pre data-language="text">literal </script> and $&</pre>';
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
  const output = path.join(directory, "round.html");
  await exec(process.execPath, [pair, "build", source, output]);
  assert.equal(await fs.readFile(output, "utf8"), html);
  await assert.rejects(
    exec(process.execPath, [pair, "build", source, output]),
    /EEXIST/,
  );

  // npm installs the command as a symlink to src/cli.mjs.
  const link = path.join(directory, "pair");
  await fs.symlink(pair, link);
  const linked = path.join(directory, "linked.html");
  await exec(process.execPath, [link, "build", source, linked]);
  assert.equal(await fs.readFile(linked, "utf8"), html);
  await assert.rejects(exec(process.execPath, [link, "build"]), /Usage/);
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
  // The build refuses a page that breaks one of its rules, so this fails
  // when a fixture page does.
  await exec(process.execPath, [
    path.join(root, "tests/fixture/build.mjs"),
    output,
  ]);
  const plan = readPlanData(await fs.readFile(output, "utf8"));
  assert.equal(plan.title, "Component fixture");
});
