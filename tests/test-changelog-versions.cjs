"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../extension/changelog-versions.js"), "utf8"), context);
const Versions = context.IKnowReaderChangelogVersions;
const plain = value => value === null ? null : JSON.parse(JSON.stringify(value));
const release = (id, version, extra = {}) => ({ id, version, status: "released", ...extra });
assert.equal(Object.isFrozen(Versions), true);
assert.deepEqual(Object.keys(Versions).sort(), ["compare", "sameReleaseLine", "select"]);
for (const [a, b, expected] of [
  ["1.41.1", "1.41.2", -1], ["1.41.10", "1.41.2", 1], ["2.0.0", "1.65535.65535", 1],
  ["1.41.2", "1.41.2.0", 0], ["1.41.2.1", "1.41.2", 1], ["0.0.0", "0.0.0.0", 0],
  ["65535.65535.65535.65535", "65535.65535.65535", 1]
]) {
  assert.equal(Versions.compare(a, b), expected);
  assert.equal(Versions.compare(b, a), expected === 0 ? 0 : -expected);
}
const invalid = [undefined, null, 1412, {}, "", "1", "1.41", "1.41.2.0.0", "01.41.2", "1.041.2", "1.41.02",
  "1.41.2-beta", "v1.41.2", " 1.41.2", "1.41.2 ", "1.41.2\n", "1.41.-2", "1.41.2.5e1", "1.41.65536", "65536.0.0", "999999.0.0", "１.４１.２"];
for (const value of invalid) {
  assert.equal(Versions.compare(value, "1.41.2"), null);
  assert.equal(Versions.compare("1.41.2", value), null);
  assert.equal(Versions.sameReleaseLine(value, "1.41.2"), false);
  assert.equal(Versions.select([release("valid", "1.41.1")], value), null);
}
assert.equal(Versions.sameReleaseLine("1.41.1", "1.41.2.3"), true);
assert.equal(Versions.sameReleaseLine("1.41.1", "1.42.0"), false);
assert.equal(Versions.sameReleaseLine("1.41.1", "2.41.1"), false);
const notes = [release("oldest", "1.40.5"), release("future", "1.41.10"), release("newest", "1.41.2"),
  release("draft", "1.41.3", { status: "unreleased" }), release("previous", "1.41.1")];
const before = JSON.stringify(notes);
assert.deepEqual(plain(Versions.select(notes, "1.41.2")), { id: "newest", version: "1.41.2" });
assert.deepEqual(plain(Versions.select(notes, "1.41.9")), { id: "newest", version: "1.41.2" });
assert.deepEqual(plain(Versions.select([...notes].reverse(), "1.41.9")), { id: "newest", version: "1.41.2" });
assert.deepEqual(plain(Versions.select(notes, "1.41.10")), { id: "future", version: "1.41.10" });
assert.equal(Versions.select(notes, "1.0.0"), null);
assert.equal(JSON.stringify(notes), before, "Selection never mutates bundled history");
const equalVersions = [release("four-parts", "1.41.2.0"), release("three-parts", "1.41.2")];
assert.deepEqual(plain(Versions.select(equalVersions, "1.41.2")), { id: "three-parts", version: "1.41.2" });
assert.deepEqual(plain(Versions.select([...equalVersions].reverse(), "1.41.2.0")), { id: "four-parts", version: "1.41.2.0" });
assert.deepEqual(plain(Versions.select([release("first", "1.41.2"), release("second", "1.41.2")], "1.41.3")), { id: "first", version: "1.41.2" });
for (const id of ["../popup", "https://example.com", "#newest", "", "With-Caps", "has space", "valid\n", "x".repeat(81), null]) {
  assert.deepEqual(plain(Versions.select([release(id, "1.41.2"), release("safe", "1.41.1")], "1.41.2")), { id: "safe", version: "1.41.1" });
}
const malformed = [null, [], "release", 4, {}, { id: "missing-status", version: "1.41.2" },
  Object.create(release("inherited", "1.41.2")), release("draft", "1.41.2", { status: "unreleased" }),
  release("future", "1.42.0"), ...invalid.map(version => release("bad-version", version))];
assert.equal(Versions.select(malformed, "1.41.2"), null);
for (const value of [null, undefined, {}, "history", new Array(101).fill(release("bounded", "1.41.2"))]) {
  assert.equal(Versions.select(value, "1.41.2"), null);
}
assert.deepEqual(plain(Versions.select(new Array(100).fill(release("bounded", "1.41.2")), "1.41.2")), { id: "bounded", version: "1.41.2" });
const selected = Versions.select(notes, "1.41.2");
selected.id = "caller-edit";
assert.equal(notes.find(entry => entry.version === "1.41.2").id, "newest", "Return a copied target, not a mutable source entry");
console.log("PASS Changelog versions: bounded numeric comparison, exact/fallback selection, unsorted history, future/draft/unsafe exclusion, immutable source and same-release-line checks");
