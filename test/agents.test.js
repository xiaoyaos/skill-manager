const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { resolveAgent } = require("../src/agents");
const { codexHome } = require("../src/config");

test("resolves Codex global by default", () => {
  const agent = resolveAgent({});
  assert.equal(agent.key, "codex-global");
  assert.equal(agent.agent, "codex");
  assert.equal(agent.skillsDir, path.join(codexHome(), "skills"));
});

test("resolves Codex project scope against the given project directory", () => {
  const agent = resolveAgent({
    agent: "codex",
    scope: "project",
    projectDir: "/tmp/example-project",
  });
  assert.equal(agent.key, "codex-project");
  assert.equal(agent.skillsDir, "/tmp/example-project/.codex/skills");
});

test("accepts an exact profile key", () => {
  const agent = resolveAgent({ key: "codex-global" });
  assert.equal(agent.key, "codex-global");
});

test("rejects unknown agents", () => {
  assert.throws(() => resolveAgent({ agent: "unknown" }), /unknown agent/);
});

test("rejects invalid scopes", () => {
  assert.throws(
    () => resolveAgent({ agent: "codex", scope: "workspace" }),
    /invalid scope/,
  );
  assert.throws(
    () => resolveAgent({ agent: "opencode", scope: "project" }),
    /does not support project scope/,
  );
});
