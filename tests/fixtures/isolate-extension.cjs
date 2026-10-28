/* Disable distribution in a separate browser fixture before its worker starts. */
"use strict";
const fs = require("node:fs"), path = require("node:path");
module.exports = function isolate(source, evidence, { updatesEnabled = false } = {}) {
  const target = path.join(evidence, "extension-fixture-" + Date.now());
  fs.cpSync(source, target, { recursive: true });
  const config = path.join(target, "update-config.json");
  fs.writeFileSync(config, JSON.stringify({ ...JSON.parse(fs.readFileSync(config, "utf8")), enabled: updatesEnabled }));
  return target;
};
