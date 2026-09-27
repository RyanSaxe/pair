// A file aims for 500 lines or fewer and never passes 1000. ESLint's
// max-lines rule checks each JavaScript file: this config fails a file over
// 1000 lines, and CI runs it again with the rule at 500 as a warning, which
// lists each file over the aim without failing.
export default [
  // frame.js stays one file until the frame split breaks it into modules.
  { ignores: ["src/frame/frame.js"] },
  { rules: { "max-lines": ["error", 1000] } },
];
