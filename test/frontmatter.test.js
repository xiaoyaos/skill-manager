const assert = require("node:assert/strict");
const test = require("node:test");

const { parseFrontmatter } = require("../src/frontmatter");

test("parses plain and quoted frontmatter values", () => {
  const meta = parseFrontmatter(`---
name: example-skill
description: "带引号的描述：包含冒号"
metadata:
  short-description: 简短描述
---`);
  assert.equal(meta.name, "example-skill");
  assert.equal(meta.description, "带引号的描述：包含冒号");
  assert.equal(meta.metadata["short-description"], "简短描述");
});

test("parses block scalars", () => {
  const meta = parseFrontmatter(`---
name: example
description: >
  第一行
  第二行
---`);
  assert.equal(meta.description, "第一行 第二行");
});

test("returns empty object without frontmatter", () => {
  assert.deepEqual(parseFrontmatter("# no frontmatter"), {});
});
