import os from "node:os";
import path from "node:path";

// The builder adds the components under $XDG_CONFIG_HOME/pair/components to
// every page it builds. A test builds with pair's own components only, so the
// variable names a directory that does not exist.
process.env.XDG_CONFIG_HOME = path.join(
  os.tmpdir(),
  `pair-test-no-config-${process.pid}`,
);
