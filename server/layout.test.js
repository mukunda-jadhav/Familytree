import test from "node:test";
import assert from "node:assert/strict";
import { example } from "../src/data.js";
import { layout, CARD_WIDTH, CARD_HEIGHT } from "../src/layout.js";

function segments(path) {
  return path.sections.flatMap((points) =>
    points.slice(1).map((p, i) => [points[i], p]),
  );
}
function overlapsCard([a, b], card) {
  if (a.x === b.x)
    return (
      a.x > card.x &&
      a.x < card.x + CARD_WIDTH &&
      Math.max(a.y, b.y) > card.y &&
      Math.min(a.y, b.y) < card.y + CARD_HEIGHT
    );
  return (
    a.y > card.y &&
    a.y < card.y + CARD_HEIGHT &&
    Math.max(a.x, b.x) > card.x &&
    Math.min(a.x, b.x) < card.x + CARD_WIDTH
  );
}
function intersects([a, b], [c, d]) {
  if (a.x === b.x && c.y === d.y)
    return (
      a.x >= Math.min(c.x, d.x) &&
      a.x <= Math.max(c.x, d.x) &&
      c.y >= Math.min(a.y, b.y) &&
      c.y <= Math.max(a.y, b.y)
    );
  if (a.y === b.y && c.x === d.x) return intersects([c, d], [a, b]);
  if (a.x === b.x && c.x === d.x)
    return (
      a.x === c.x &&
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) >
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
    );
  return (
    a.y === c.y &&
    Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) >
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
  );
}
function assertClearCards(drawing) {
  const cards = Object.values(drawing.positions);
  for (const path of drawing.paths)
    for (const segment of segments(path)) {
      assert.ok(
        segment[0].x === segment[1].x || segment[0].y === segment[1].y,
        "orthogonal route",
      );
      for (const card of cards)
        assert.equal(
          overlapsCard(segment, card),
          false,
          "connection passes through a person card",
        );
    }
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i],
        b = cards[j];
      assert.ok(
        a.x + CARD_WIDTH <= b.x ||
          b.x + CARD_WIDTH <= a.x ||
          a.y + CARD_HEIGHT <= b.y ||
          b.y + CARD_HEIGHT <= a.y,
        "person cards overlap",
      );
    }
}
test("sample families have shared sibling branches and zero unrelated crossings", async () => {
  const drawing = await layout(example);
  assertClearCards(drawing);
  const blood = drawing.paths.filter((p) => p.type === "blood");
  assert.equal(blood.length, 3);
  assert.equal(drawing.generations, 3);
  for (let i = 0; i < blood.length; i++)
    for (let j = i + 1; j < blood.length; j++) {
      for (const a of segments(blood[i]))
        for (const b of segments(blood[j]))
          assert.equal(
            intersects(a, b),
            false,
            "separate family branches cross or overlap",
          );
    }
  const topFamily = blood.find((p) => p.parents.includes(example.people[0].id));
  assert.deepEqual(
    new Set(topFamily.children),
    new Set([example.people[2].id, example.people[4].id]),
  );
  assert.equal(topFamily.parents.length, 2);
});
test("shuffled input still routes around every card", async () => {
  const drawing = await layout({
    ...example,
    people: [...example.people].reverse(),
    edges: [...example.edges].reverse(),
  });
  assertClearCards(drawing);
});
test("a child of only one partner is never shown as the child of both", async () => {
  const t = structuredClone(example);
  const child = {
    ...t.people[0],
    id: "step-child",
    name: "Child of one parent",
  };
  t.people.push(child);
  t.edges.push({
    id: "step-edge",
    from: t.people[2].id,
    to: child.id,
    type: "blood",
  });
  const drawing = await layout(t);
  const branch = drawing.paths.find((p) => p.children?.includes(child.id));
  assert.deepEqual(branch.parents, [t.people[2].id]);
  assertClearCards(drawing);
});
test("adoptive connections keep their own relationship type", async () => {
  const t = structuredClone(example);
  t.edges.find((e) => e.to === t.people[7].id).type = "adoptive";
  const drawing = await layout(t);
  assertClearCards(drawing);
  assert.equal(
    drawing.paths.find((p) => p.children?.includes(t.people[7].id)).type,
    "adoptive",
  );
});
test("empty trees and disconnected people have valid layouts", async () => {
  const empty = await layout({ people: [], edges: [] });
  assert.equal(empty.generations, 0);
  const drawing = await layout({ people: example.people, edges: [] });
  assertClearCards(drawing);
  assert.equal(drawing.paths.length, 0);
});
