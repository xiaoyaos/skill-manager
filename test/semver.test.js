const assert = require("node:assert/strict");
const test = require("node:test");

const { compareVersions } = require("../src/update");

test("compares stable versions", () => {
  assert.equal(Math.sign(compareVersions("0.2.0", "0.1.9")), 1);
  assert.equal(Math.sign(compareVersions("0.2.0", "0.2.0")), 0);
  assert.equal(Math.sign(compareVersions("0.2.0", "0.10.0")), -1);
});

test("compares prerelease versions", () => {
  assert.equal(Math.sign(compareVersions("1.0.0-beta.2", "1.0.0-beta.1")), 1);
  assert.equal(Math.sign(compareVersions("1.0.0", "1.0.0-beta.1")), 1);
  assert.equal(Math.sign(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.beta")), -1);
  assert.equal(Math.sign(compareVersions("1.0.0-alpha.beta", "1.0.0-beta")), -1);
});
