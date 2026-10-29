// The libraries the frame loads from CDNs, each pinned to one version.
export const libraries = {
  shiki: "https://esm.sh/shiki@3.12.2",
  diffs: "https://esm.sh/@pierre/diffs@1.4.2?bundle",
  pele: "https://cdn.jsdelivr.net/npm/pele@1.6.0/dist/pele.js",
  katex: "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js",
  katexCss: "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css",
  echarts: "https://cdn.jsdelivr.net/npm/echarts@6.0.0/dist/echarts.min.js",
};
// import() takes no integrity of its own, so the page's import map carries
// the hash of each module the frame imports from a CDN. A browser that does
// not read integrity from an import map loads the module unchecked.
// Shiki and the diff library are left out: esm.sh builds them on demand
// and they import esm.sh's unversioned polyfills, so no hash stays valid.
export const moduleIntegrity = {
  [libraries.pele]:
    "sha384-Ng9KJW8Ze6GDIOWm/JKzcpXzD5y8ujBhhqqYBuHgFHq1370bMcs4T+3nuIMmCBT2",
};
