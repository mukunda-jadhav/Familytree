// Person cards are fixed-size obstacles. ELK orders family units and routes
// orthogonal connections around them; siblings share one explicit family hub.
export const CARD_WIDTH = 220;
export const CARD_HEIGHT = 116;
const PARTNER_GAP = 64;
let engine;

function pointPath(points) {
  return points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
}

function branchJunctions(sections) {
  const segments = sections.flatMap((points) =>
    points.slice(1).map((p, i) => [points[i], p]),
  );
  const candidates = new Map(sections.flat().map((p) => [`${p.x}:${p.y}`, p]));
  return [...candidates.values()].filter((p) => {
    const directions = new Set();
    for (const [a, b] of segments) {
      if (
        a.x === b.x &&
        p.x === a.x &&
        p.y >= Math.min(a.y, b.y) &&
        p.y <= Math.max(a.y, b.y)
      ) {
        if (Math.min(a.y, b.y) < p.y) directions.add("up");
        if (Math.max(a.y, b.y) > p.y) directions.add("down");
      }
      if (
        a.y === b.y &&
        p.y === a.y &&
        p.x >= Math.min(a.x, b.x) &&
        p.x <= Math.max(a.x, b.x)
      ) {
        if (Math.min(a.x, b.x) < p.x) directions.add("left");
        if (Math.max(a.x, b.x) > p.x) directions.add("right");
      }
    }
    return directions.size >= 3;
  });
}

export async function layout(tree) {
  if (!engine)
    engine = import("elkjs/lib/elk.bundled.js").then(
      ({ default: ELK }) => new ELK(),
    );
  const elk = await engine;
  const ids = new Set(tree.people.map((p) => p.id));
  const edges = tree.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const units = [],
    unitOf = new Map(),
    paired = new Set();
  const peopleOrder = new Map(tree.people.map((p, i) => [p.id, i]));
  const addUnit = (members) => {
    members.sort((a, b) => peopleOrder.get(a) - peopleOrder.get(b));
    const unit = {
      id: `unit:${units.length}`,
      members,
      width: members.length * CARD_WIDTH + (members.length - 1) * PARTNER_GAP,
      height: CARD_HEIGHT,
      ports: [],
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    };
    members.forEach((id, i) =>
      unitOf.set(id, { unit, offset: i * (CARD_WIDTH + PARTNER_GAP) }),
    );
    units.push(unit);
  };
  // Keep an explicit couple together. Further partnerships remain explicit
  // routed edges rather than folding unrelated partners into one household.
  for (const e of edges.filter((e) => e.type === "partner")) {
    if (!paired.has(e.from) && !paired.has(e.to)) {
      addUnit([e.from, e.to]);
      paired.add(e.from);
      paired.add(e.to);
    }
  }
  tree.people.filter((p) => !paired.has(p.id)).forEach((p) => addUnit([p.id]));

  function port(unit, id, x, side) {
    if (!unit.ports.some((p) => p.id === id))
      unit.ports.push({
        id,
        x,
        y: side === "NORTH" ? 0 : CARD_HEIGHT,
        width: 0,
        height: 0,
        layoutOptions: { "elk.port.side": side },
      });
    return id;
  }
  const childrenByParents = new Map();
  for (const child of tree.people) {
    for (const type of ["blood", "adoptive"]) {
      const parents = edges
        .filter((e) => e.to === child.id && e.type === type)
        .map((e) => e.from)
        .sort();
      if (!parents.length) continue;
      const key = JSON.stringify([type, parents]);
      if (!childrenByParents.has(key))
        childrenByParents.set(key, { type, parents, children: [] });
      childrenByParents.get(key).children.push(child.id);
    }
  }
  const hubs = [],
    graphEdges = [],
    families = [...childrenByParents.values()];
  families.forEach((family, index) => {
    const hub = {
      id: `family:${index}`,
      width: 2,
      height: 2,
      ports: [
        {
          id: `family:${index}:in`,
          x: 1,
          y: 0,
          width: 0,
          height: 0,
          layoutOptions: { "elk.port.side": "NORTH" },
        },
        {
          id: `family:${index}:out`,
          x: 1,
          y: 2,
          width: 0,
          height: 0,
          layoutOptions: { "elk.port.side": "SOUTH" },
        },
      ],
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    };
    hubs.push(hub);
    family.id = hub.id;
    family.stems = [];
    const parentsByUnit = new Map();
    family.parents.forEach((id) => {
      const { unit } = unitOf.get(id);
      if (!parentsByUnit.has(unit.id)) parentsByUnit.set(unit.id, []);
      parentsByUnit.get(unit.id).push(id);
    });
    for (const parents of parentsByUnit.values()) {
      const { unit, offset } = unitOf.get(parents[0]);
      const couple = parents.length === 2;
      const x = couple ? unit.width / 2 : offset + CARD_WIDTH / 2;
      const source = port(
        unit,
        `${unit.id}:out:${couple ? "couple" : parents[0]}`,
        x,
        "SOUTH",
      );
      graphEdges.push({
        id: `${hub.id}:from:${unit.id}`,
        sources: [source],
        targets: [`${hub.id}:in`],
        family: hub.id,
      });
      if (couple) family.stems.push({ unit: unit.id, x });
    }
    family.children.forEach((id) => {
      const { unit, offset } = unitOf.get(id);
      const target = port(
        unit,
        `${unit.id}:in:${id}`,
        offset + CARD_WIDTH / 2,
        "NORTH",
      );
      graphEdges.push({
        id: `${hub.id}:to:${id}`,
        sources: [`${hub.id}:out`],
        targets: [target],
        family: hub.id,
      });
    });
  });
  edges
    .filter((e) => e.type === "partner")
    .forEach((e) => {
      const a = unitOf.get(e.from),
        b = unitOf.get(e.to);
      if (a.unit === b.unit) return;
      const source = port(
        a.unit,
        `partner:${e.id}:from`,
        a.offset + CARD_WIDTH / 2 + 35,
        "SOUTH",
      );
      const target = port(
        b.unit,
        `partner:${e.id}:to`,
        b.offset + CARD_WIDTH / 2 + 35,
        "NORTH",
      );
      graphEdges.push({
        id: e.id,
        sources: [source],
        targets: [target],
        partner: e.id,
      });
    });
  const graph = await elk.layout({
    id: "root",
    children: [...units, ...hubs],
    edges: graphEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": "[top=44,left=44,bottom=44,right=44]",
      "elk.spacing.nodeNode": "76",
      "elk.spacing.edgeNode": "28",
      "elk.spacing.edgeEdge": "18",
      "elk.layered.spacing.nodeNodeBetweenLayers": "48",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "18",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.thoroughness": "20",
      "elk.randomSeed": "1",
      "elk.separateConnectedComponents": "true",
    },
  });
  const nodes = new Map(graph.children.map((n) => [n.id, n]));
  const positions = {};
  for (const person of tree.people) {
    const { unit, offset } = unitOf.get(person.id),
      n = nodes.get(unit.id);
    positions[person.id] = { x: n.x + offset, y: n.y };
  }
  const routes = new Map();
  for (const edge of graph.edges) {
    routes.set(
      edge.id,
      (edge.sections || []).map((s) => [
        s.startPoint,
        ...(s.bendPoints || []),
        s.endPoint,
      ]),
    );
  }
  const paths = [];
  for (const family of families) {
    const sections = graphEdges
      .filter((e) => e.family === family.id)
      .flatMap((e) => routes.get(e.id) || []);
    const hub = nodes.get(family.id);
    sections.push([
      { x: hub.x + 1, y: hub.y },
      { x: hub.x + 1, y: hub.y + 2 },
    ]);
    for (const stem of family.stems) {
      const unit = nodes.get(stem.unit);
      sections.push([
        { x: unit.x + stem.x, y: unit.y + CARD_HEIGHT / 2 },
        { x: unit.x + stem.x, y: unit.y + CARD_HEIGHT },
      ]);
    }
    const junctions = branchJunctions(sections);
    for (const stem of family.stems) {
      const unit = nodes.get(stem.unit);
      junctions.push({ x: unit.x + stem.x, y: unit.y + CARD_HEIGHT / 2 });
    }
    paths.push({
      id: family.id,
      type: family.type,
      members: [...family.parents, ...family.children],
      parents: family.parents,
      children: family.children,
      sections,
      d: sections.map(pointPath).join(" "),
      junctions,
    });
  }
  for (const e of edges.filter((e) => e.type === "partner")) {
    const a = unitOf.get(e.from),
      b = unitOf.get(e.to);
    let sections;
    if (a.unit === b.unit) {
      const n = nodes.get(a.unit.id);
      sections = [
        [
          { x: n.x + CARD_WIDTH, y: n.y + CARD_HEIGHT / 2 },
          { x: n.x + CARD_WIDTH + PARTNER_GAP, y: n.y + CARD_HEIGHT / 2 },
        ],
      ];
    } else sections = routes.get(e.id) || [];
    paths.unshift({
      id: e.id,
      type: "partner",
      members: [e.from, e.to],
      sections,
      d: sections.map(pointPath).join(" "),
    });
  }
  const parentIds = new Map();
  for (const edge of edges.filter((e) => e.type !== "partner")) {
    if (!parentIds.has(edge.to)) parentIds.set(edge.to, []);
    parentIds.get(edge.to).push(edge.from);
  }
  const depths = new Map();
  function depth(id, visiting = new Set()) {
    if (depths.has(id)) return depths.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const value =
      1 +
      Math.max(
        0,
        ...(parentIds.get(id) || []).map((parent) => depth(parent, visiting)),
      );
    visiting.delete(id);
    depths.set(id, value);
    return value;
  }
  return {
    positions,
    paths,
    width: Math.max(900, graph.width || 0),
    height: Math.max(600, graph.height || 0),
    generations: Math.max(0, ...tree.people.map((person) => depth(person.id))),
  };
}
