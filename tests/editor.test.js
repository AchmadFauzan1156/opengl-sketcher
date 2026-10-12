import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./load.js";

const { MeshGeometry: G, MeshEditor: E } = load("geometry.js", "editor.js");

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
function setup() {
  const ed = E.create();
  ed.replaceAll([
    { id: 1, name: "A", color: "#ff0000", points: rect(-0.8, -0.2, 0.2, 0.2) },
    { id: 2, name: "B", color: "#00ff00", points: rect(-0.1, -0.1, 0.2, 0.2) },
    { id: 3, name: "C", color: "#0000ff", points: rect(0.5, 0.2, 0.3, 0.3) },
  ]);
  ed.history = [];
  return ed;
}
const ids = (ed) => ed.shapes.map((s) => s.id);
const sel = (ed) => [...ed.selection].sort();
const exportOf = (ed) => G.exportCpp(G.buildMesh(ed.shapes));

test("single selection, toggle, select all, deselect", () => {
  const ed = setup();
  ed.selectOnly(2);
  assert.deepEqual(sel(ed), [2]);
  assert.equal(ed.primaryId, 2);
  ed.toggle(3);
  assert.deepEqual(sel(ed), [2, 3]);
  assert.equal(ed.primaryId, 3);
  ed.toggle(2);
  assert.deepEqual(sel(ed), [3]);
  ed.selectAll();
  assert.deepEqual(sel(ed), [1, 2, 3]);
  ed.clearSelection();
  assert.deepEqual(sel(ed), []);
  assert.equal(ed.primaryId, null);
});

test("select all skips hidden and locked shapes", () => {
  const ed = setup();
  ed.setFlag(1, "hidden", true);
  ed.setFlag(2, "locked", true);
  ed.selectAll();
  assert.deepEqual(sel(ed), [3]);
});

test("marquee selection requires full containment", () => {
  const ed = setup();
  ed.selectInRect({ x1: -1, y1: -1, x2: 0.2, y2: 0.2 });
  assert.deepEqual(sel(ed), [1, 2]);
  ed.selectInRect({ x1: 0.4, y1: 0.1, x2: 0.9, y2: 0.4 }, true);
  assert.deepEqual(sel(ed), [1, 2], "C only partially covered");
  ed.selectInRect({ x1: 0.4, y1: 0.1, x2: 0.9, y2: 0.6 }, true);
  assert.deepEqual(sel(ed), [1, 2, 3]);
});

test("multi delete is a single undoable entry and restores selection", () => {
  const ed = setup();
  ed.setSelection([1, 3]);
  const res = ed.deleteSelection();
  assert.ok(res.ok);
  assert.deepEqual(ids(ed), [2]);
  assert.equal(ed.history.length, 1);
  ed.undo();
  assert.deepEqual(ids(ed), [1, 2, 3]);
  assert.deepEqual(sel(ed), [1, 3]);
  ed.redo();
  assert.deepEqual(ids(ed), [2]);
  assert.deepEqual(sel(ed), []);
});

test("copy does not modify the document; paste creates fresh ids with offset", () => {
  const ed = setup();
  ed.setSelection([1, 2]);
  const before = JSON.stringify(ed.shapes);
  ed.copy();
  assert.equal(JSON.stringify(ed.shapes), before);
  assert.equal(ed.history.length, 0);
  const r1 = ed.paste();
  assert.ok(r1.ok);
  assert.equal(ed.shapes.length, 5);
  assert.deepEqual(sel(ed), [4, 5]);
  const [a, b] = ed.selected();
  assert.equal(a.color, "#ff0000");
  assert.equal(a.name, "A salinan");
  // Relative positioning preserved, predictable offset (+0.05, −0.05).
  assert.deepEqual(a.points[0], { x: -0.75, y: -0.25 });
  assert.deepEqual(b.points[0], { x: -0.05, y: -0.15 });
  ed.paste();
  assert.deepEqual(ed.selected()[0].points[0], { x: -0.7, y: -0.3 });
  assert.equal(ed.history.length, 2);
  ed.undo();
  ed.undo();
  assert.deepEqual(ids(ed), [1, 2, 3]);
});

test("paste near the boundary clamps rigidly instead of distorting", () => {
  const ed = setup();
  ed.replaceAll([{ id: 1, name: "Edge", color: "#ff0000", points: rect(0.8, -1, 0.2, 0.2) }]);
  ed.selectOnly(1);
  ed.copy();
  const res = ed.paste();
  assert.ok(res.ok);
  const pasted = ed.primary();
  assert.deepEqual(pasted.points, ed.byId(1).points, "fully constrained → in place");
  assert.equal(G.checkPolygon(pasted.points), null);
});

test("cut removes, keeps clipboard, pastes back in place, undoable", () => {
  const ed = setup();
  ed.selectOnly(3);
  const original = G.clone(ed.byId(3).points);
  ed.cut();
  assert.deepEqual(ids(ed), [1, 2]);
  assert.equal(ed.history.length, 1);
  ed.paste();
  assert.deepEqual(ed.primary().points, original);
  assert.equal(ed.primary().name, "C");
  ed.undo();
  ed.undo();
  assert.deepEqual(ids(ed), [1, 2, 3]);
});

test("duplicate multiple objects in one history entry", () => {
  const ed = setup();
  ed.setSelection([1, 2]);
  ed.duplicate();
  assert.equal(ed.shapes.length, 5);
  assert.equal(ed.history.length, 1);
  assert.deepEqual(ed.selected()[0].points[0], { x: -0.7, y: -0.3 });
});

test("paste respects MAX_SHAPES", () => {
  const ed = E.create();
  const many = Array.from({ length: G.MAX_SHAPES }, (_, i) => ({
    id: i + 1,
    name: `S${i}`,
    color: "#ffffff",
    points: rect(-0.9, -0.9, 0.1, 0.1),
  }));
  ed.replaceAll(many);
  ed.selectOnly(1);
  ed.copy();
  const res = ed.paste();
  assert.equal(res.ok, false);
  assert.match(res.error, /Maksimal/);
  assert.equal(ed.shapes.length, G.MAX_SHAPES);
});

test("transforms are transactional: one invalid shape rolls back all", () => {
  const ed = setup();
  ed.setSelection([1, 2, 3]);
  const before = JSON.stringify(ed.shapes);
  const histLen = ed.history.length;
  const res = ed.scale(3, 3); // C would leave NDC
  assert.equal(res.ok, false);
  assert.equal(JSON.stringify(ed.shapes), before);
  assert.equal(ed.history.length, histLen);
});

test("rotate, flip, scale, nudge and alignment keep valid geometry", () => {
  const ed = setup();
  ed.setSelection([2]);
  assert.ok(ed.rotate(45).ok);
  assert.equal(G.checkPolygon(ed.byId(2).points), null);
  assert.ok(ed.rotate(-45).ok);
  ed.byId(2).points.forEach((p, i) => {
    const o = rect(-0.1, -0.1, 0.2, 0.2)[i];
    assert.ok(Math.abs(p.x - o.x) < 1e-4 && Math.abs(p.y - o.y) < 1e-4);
  });
  assert.ok(ed.flip("x").ok);
  assert.ok(ed.scale(2, 1).ok);
  assert.equal(G.bounds(ed.byId(2).points).w.toFixed(5), "0.40000");
  assert.ok(ed.nudge(0.01, 0).ok);
  assert.ok(ed.nudge(0.01, 0).ok);
  // rapid nudges coalesce into a single history entry
  assert.equal(ed.history.length, 5); // rotate, rotate, flip, scale, nudge×2
  ed.setSelection([1, 2, 3]);
  assert.ok(ed.align("left").ok);
  for (const s of ed.selected()) assert.equal(G.bounds(s.points).minX, -0.8);
  assert.ok(ed.align("top").ok);
  for (const s of ed.selected()) assert.equal(G.bounds(s.points).maxY, 0.5);
});

test("distribute horizontally spaces gaps evenly", () => {
  const ed = setup();
  ed.setSelection([1, 2, 3]);
  ed.byId(2).points = rect(0.3, -0.1, 0.1, 0.1);
  assert.ok(ed.distribute("x").ok);
  const bs = ed.shapes.map((s) => G.bounds(s.points)).sort((a, b) => a.minX - b.minX);
  const gap1 = bs[1].minX - bs[0].maxX;
  const gap2 = bs[2].minX - bs[1].maxX;
  assert.ok(Math.abs(gap1 - gap2) < 1e-4);
});

test("setBounds resizes around the center and moves", () => {
  const ed = setup();
  ed.selectOnly(2);
  assert.ok(ed.setBounds({ w: 0.4, h: 0.1, cx: 0.5, cy: -0.5 }).ok);
  const b = G.bounds(ed.byId(2).points);
  assert.equal(b.w.toFixed(5), "0.40000");
  assert.equal(b.h.toFixed(5), "0.10000");
  assert.equal(b.cx.toFixed(5), "0.50000");
  assert.equal(ed.setBounds({ w: 0 }).ok, false);
});

test("locked shapes refuse geometry mutations", () => {
  const ed = setup();
  ed.setFlag(2, "locked", true);
  ed.selectOnly(2);
  assert.equal(ed.rotate(90).ok, false);
  assert.equal(ed.deleteSelection().ok, false);
  assert.equal(ed.nudge(0.1, 0).ok, false);
});

test("gesture drag: preview many moves, one entry, rollback on invalid", () => {
  const ed = setup();
  ed.setSelection([1, 2]);
  ed.beginGesture();
  for (let i = 1; i <= 20; i++)
    ed.previewSelection((pts) => G.translatePoints(pts, i * 0.01, 0));
  const res = ed.endGesture();
  assert.ok(res.ok);
  assert.equal(ed.history.length, 1);
  assert.deepEqual(ed.byId(1).points[0], { x: -0.6, y: -0.2 });

  // Vertex drag that self-intersects is rolled back.
  ed.selectOnly(2);
  ed.selectedVertex = 0;
  ed.beginGesture();
  ed.previewVertex(2, 0, { x: 0.3, y: 0.3 }); // crosses edges → bowtie
  const bad = ed.endGesture();
  assert.equal(bad.ok, false);
  assert.equal(ed.history.length, 1);
  assert.deepEqual(ed.byId(2).points[0], { x: 0.1, y: -0.1 });

  // Out-of-bounds previews are skipped.
  ed.beginGesture();
  assert.equal(ed.previewSelection((pts) => G.translatePoints(pts, 5, 0)), false);
  assert.ok(ed.endGesture().noop);
});

test("layer ordering moves selected shapes as a block", () => {
  const ed = setup();
  ed.setSelection([1, 2]);
  ed.layerMove(1);
  assert.deepEqual(ids(ed), [3, 1, 2]);
  ed.layerMove(1);
  assert.deepEqual(ids(ed), [3, 1, 2], "already on top → no-op");
  assert.equal(ed.history.length, 1);
  ed.layerMove(-1);
  assert.deepEqual(ids(ed), [1, 2, 3]);
  ed.undo();
  assert.deepEqual(ids(ed), [3, 1, 2]);
  assert.deepEqual(sel(ed), [1, 2], "selection survives layer reorder undo");
});

test("group selection and ungroup; paste remaps group ids", () => {
  const ed = setup();
  ed.setSelection([1, 2]);
  assert.ok(ed.group().ok);
  ed.clearSelection();
  ed.selectOnly(1);
  assert.deepEqual(sel(ed), [1, 2], "picking a member selects the group");
  ed.selectOnly(1, { group: false });
  assert.deepEqual(sel(ed), [1]);
  ed.selectOnly(1);
  ed.copy();
  ed.paste();
  const pasted = ed.selected();
  assert.equal(new Set(pasted.map((s) => s.groupId)).size, 1);
  assert.notEqual(pasted[0].groupId, ed.byId(1).groupId);
  assert.ok(ed.ungroup().ok);
  assert.ok(ed.selected().every((s) => s.groupId == null));
});

test("colour change applies to all selected and is undoable", () => {
  const ed = setup();
  ed.setSelection([1, 3]);
  ed.setColor("#ABCDEF");
  assert.equal(ed.byId(1).color, "#abcdef");
  assert.equal(ed.byId(3).color, "#abcdef");
  assert.equal(ed.byId(2).color, "#00ff00");
  ed.undo();
  assert.equal(ed.byId(1).color, "#ff0000");
  assert.equal(ed.setColor("red").ok, false);
});

test("no-op actions do not create history entries", () => {
  const ed = setup();
  ed.selectOnly(2);
  ed.setColor("#00ff00");
  ed.rotate(0);
  ed.rename(2, "B");
  ed.editVertex(0, "x", -0.1);
  assert.equal(ed.history.length, 0);
});

test("history keeps at most 80 entries", () => {
  const ed = setup();
  ed.selectOnly(2);
  for (let i = 0; i < 100; i++) ed.setColor(i % 2 ? "#111111" : "#222222");
  assert.equal(ed.history.length, E.HISTORY_LIMIT);
});

test("vertex edit validation rejects self-intersection", () => {
  const ed = setup();
  ed.selectOnly(2);
  const res = ed.editVertex(0, "x", 0.5);
  assert.equal(res.ok, false);
  assert.equal(ed.history.length, 0);
});

test("viewport-independent export: editor ops that are no-ops leave C++ identical", () => {
  const ed = setup();
  const before = exportOf(ed);
  ed.selectAll();
  ed.clearSelection();
  ed.copy();
  assert.equal(exportOf(ed), before);
});

test("insert and delete vertices with validation and undo", () => {
  const ed = setup();
  ed.selectOnly(2);
  const res = ed.insertVertex(2, 0, { x: 0, y: -0.1 }); // midpoint of bottom edge
  assert.ok(res.ok, res.error);
  assert.equal(ed.byId(2).points.length, 5);
  assert.equal(ed.selectedVertex, 1);
  assert.equal(G.checkPolygon(ed.byId(2).points), null);
  assert.equal(G.buildMesh([ed.byId(2)]).indices.length, 3);
  // Drag the new point outward → still a valid concave/convex shape.
  assert.ok(ed.nudgeVertex(0, -0.1).ok);
  assert.ok(ed.deleteVertex().ok);
  assert.equal(ed.byId(2).points.length, 4);
  assert.equal(ed.selectedVertex, null);
  ed.undo();
  ed.undo();
  ed.undo();
  assert.deepEqual(ed.byId(2).points, rect(-0.1, -0.1, 0.2, 0.2));
  // Inserting a point that makes the polygon self-intersect is rejected.
  const bad = ed.insertVertex(2, 0, { x: 0, y: 0.5 });
  assert.equal(bad.ok, false);
  assert.equal(ed.byId(2).points.length, 4);
});

test("cannot delete below 3 vertices", () => {
  const ed = E.create();
  ed.replaceAll([{ id: 1, name: "T", color: "#ffffff", points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0, y: 0.5 }] }]);
  ed.selectOnly(1);
  ed.selectedVertex = 0;
  const res = ed.deleteVertex();
  assert.equal(res.ok, false);
  assert.match(res.error, /minimal 3/);
});
