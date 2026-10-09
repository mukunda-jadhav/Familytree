import { z } from "zod";
const person = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  birth: z.union([z.literal(""), z.iso.date()]),
  place: z.string().max(120),
  bio: z.string().max(2000),
  gender: z.enum(["female", "male", "other"]),
  deceased: z.boolean(),
});
export const treeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  people: z.array(person).max(500),
  edges: z
    .array(
      z.object({
        id: z.string().uuid(),
        from: z.string().uuid(),
        to: z.string().uuid(),
        type: z.enum(["blood", "partner", "adoptive"]),
      }),
    )
    .max(1500),
});
export function validateTree(input) {
  const t = treeSchema.parse(input);
  const ids = new Set(t.people.map((p) => p.id));
  if (ids.size !== t.people.length) throw Error("Duplicate person");
  const seen = new Set();
  const parents = new Map();
  for (const e of t.edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to)
      throw Error("Invalid relationship");
    const key =
      e.type === "partner"
        ? [e.from, e.to].sort().join(":")
        : `${e.from}:${e.to}`;
    if (seen.has(key)) throw Error("Duplicate relationship");
    seen.add(key);
    if (e.type !== "partner") {
      parents.set(e.to, [...(parents.get(e.to) || []), e.from]);
    }
  }
  const done = new Set(),
    active = new Set();
  function visit(id) {
    if (active.has(id)) throw Error("Ancestry cannot contain a cycle");
    if (done.has(id)) return;
    active.add(id);
    for (const p of parents.get(id) || []) visit(p);
    active.delete(id);
    done.add(id);
  }
  ids.forEach(visit);
  return t;
}
