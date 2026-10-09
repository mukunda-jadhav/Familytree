import test from "node:test";
import assert from "node:assert/strict";
import { validateTree } from "./model.js";
import { example } from "../src/data.js";
test("accepts multi-parent sample tree", () =>
  assert.equal(validateTree(example).people.length, 8));
test("rejects ancestry cycles", () => {
  const t = structuredClone(example);
  t.edges.push({
    id: crypto.randomUUID(),
    from: t.people[5].id,
    to: t.people[0].id,
    type: "blood",
  });
  assert.throws(() => validateTree(t), /cycle/);
});
test("rejects foreign person references", () => {
  const t = structuredClone(example);
  t.edges[0].from = crypto.randomUUID();
  assert.throws(() => validateTree(t), /Invalid/);
});
test("rejects duplicate partner connections in reverse", () => {
  const t = structuredClone(example);
  t.edges.push({
    ...t.edges[0],
    id: crypto.randomUUID(),
    from: t.edges[0].to,
    to: t.edges[0].from,
  });
  assert.throws(() => validateTree(t), /Duplicate/);
});
test("rejects self parenting", () => {
  const t = structuredClone(example);
  t.edges[0].to = t.edges[0].from;
  assert.throws(() => validateTree(t), /Invalid/);
});
