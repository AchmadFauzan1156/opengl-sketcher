import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./load.js";

const { MeshGeometry: G } = load("geometry.js");

const square = [
  { x: -0.5, y: -0.5 },
  { x: 0.5, y: -0.5 },
  { x: 0.5, y: 0.5 },
  { x: -0.5, y: 0.5 },
];
// Concave "L"
const ell = [
  { x: -0.6, y: -0.6 },
  { x: 0.6, y: -0.6 },
  { x: 0.6, y: -0.2 },
  { x: -0.2, y: -0.2 },
  { x: -0.2, y: 0.6 },
  { x: -0.6, y: 0.6 },
];

function assertTriangulation(points) {
  const tris = G.triangulate(points);
  assert.equal(tris.length, points.length - 2);
  let area = 0;
  for (const t of tris) {
    assert.ok(t.every((i) => Number.isInteger(i) && i >= 0 && i < points.length));
    const c = G.cross(points[t[0]], points[t[1]], points[t[2]]);
    assert.ok(c > 0, "triangle must be counter-clockwise (OpenGL front face)");
    area += c / 2;
  }
  assert.ok(
    Math.abs(area - Math.abs(G.signedArea(points))) < 1e-6,
    "triangles cover the polygon area",
  );
}

test("triangulates convex and concave polygons into CCW triangles", () => {
  assertTriangulation(square);
  assertTriangulation(ell);
  assertTriangulation([...ell].reverse());
});

test("rotate convex polygon 90° about its center", () => {
  const r = G.rotatePoints(square, Math.PI / 2, { x: 0, y: 0 });
  assert.deepEqual(r[0], { x: 0.5, y: -0.5 });
  assert.equal(G.checkPolygon(r), null);
  assertTriangulation(r);
});

test("rotate concave polygon keeps it valid and area-preserving", () => {
  for (const deg of [15, 45, 90, 180, 270, -30]) {
    const r = G.rotatePoints(ell, (deg * Math.PI) / 180, { x: 0, y: 0 });
    assert.equal(G.checkPolygon(r), null, `rotation ${deg}`);
    assert.ok(
      Math.abs(Math.abs(G.signedArea(r)) - Math.abs(G.signedArea(ell))) < 1e-4,
    );
    assertTriangulation(r);
  }
});

test("aspect-corrected rotation preserves viewport-pixel distances", () => {
  const aspect = 800 / 600;
  const px = (p) => ({ x: (p.x * 800) / 2, y: (p.y * 600) / 2 });
  const r = G.rotatePoints(square.map((p) => ({ x: p.x * 0.5, y: p.y * 0.5 })), Math.PI / 6, { x: 0, y: 0 }, aspect);
  const before = square.map((p) => px({ x: p.x * 0.5, y: p.y * 0.5 }));
  const after = r.map(px);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const d0 = Math.hypot(before[i].x - before[j].x, before[i].y - before[j].y);
    const d1 = Math.hypot(after[i].x - after[j].x, after[i].y - after[j].y);
    assert.ok(Math.abs(d0 - d1) < 0.01, `edge ${i}: ${d0} vs ${d1}`);
  }
  assertTriangulation(r);
});

test("scale and flip; flip reverses stored winding but triangles stay CCW", () => {
  const s = G.scalePoints(square, 0.5, 2, { x: 0, y: 0 });
  assert.equal(G.bounds(s).w, 0.5);
  assert.equal(G.bounds(s).h, 2);
  const f = G.scalePoints(ell, -1, 1, { x: 0, y: 0 });
  assert.ok(G.signedArea(f) * G.signedArea(ell) < 0);
  assert.equal(G.checkPolygon(f), null);
  assertTriangulation(f);
});

test("boundary, self-intersection and degenerate rejection", () => {
  assert.match(
    G.validPolygon(G.scalePoints(square, 3, 3, { x: 0, y: 0 })),
    /rentang/,
  );
  const bowtie = [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: 0.6 },
    { x: 0.5, y: -0.5 },
    { x: -0.5, y: 0.4 },
  ];
  assert.match(G.validPolygon(bowtie), /berpotongan/);
  const collinear = [
    { x: 0, y: 0 },
    { x: 0.2, y: 0 },
    { x: 0.4, y: 0 },
  ];
  assert.match(G.validPolygon(collinear), /Luas polygon nol/);
  assert.match(
    G.validPolygon([
      { x: NaN, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]),
    /rentang/,
  );
  assert.ok(G.checkPolygon(G.scalePoints(square, 1e-9, 1, { x: 0, y: 0 })));
  assert.throws(() => G.triangulate(bowtie));
});

test("clampDelta translates rigidly inside NDC", () => {
  const b = G.bounds(square);
  assert.deepEqual(G.clampDelta(b, 0.9, -0.1), { dx: 0.5, dy: -0.1 });
});

test("rectContainsPoints works with reversed rect corners", () => {
  assert.ok(G.rectContainsPoints({ x1: 0.6, y1: 0.6, x2: -0.6, y2: -0.6 }, square));
  assert.ok(!G.rectContainsPoints({ x1: 0, y1: 0, x2: 0.6, y2: 0.6 }, square));
});

test("mesh export: vertex/index counts, valid indices, 8-float layout", () => {
  const shapes = [
    { id: 1, name: "A", color: "#ff0000", points: square },
    { id: 2, name: "B", color: "#00ff00", points: ell },
    { id: 3, name: "Hidden", color: "#0000ff", points: square, hidden: true },
  ];
  const mesh = G.buildMesh(shapes);
  assert.equal(mesh.vertices.length, 10);
  assert.equal(mesh.indices.length, 2 + 4);
  for (const tri of mesh.indices)
    assert.ok(tri.i.every((i) => i >= 0 && i < mesh.vertices.length));
  const cpp = G.exportCpp(mesh);
  const vertexLines = cpp
    .split("\n")
    .filter((l) => l.includes("f,") && l.includes("·"));
  assert.equal(vertexLines.length, 10);
  for (const line of vertexLines)
    assert.equal(line.split("//")[0].match(/-?\d+\.\d{4}f/g).length, 8);
  const indexLines = cpp.split("unsigned int indices[] = {")[1].split("\n").filter((l) => l.includes("//"));
  assert.equal(indexLines.length, 6);
  assert.match(G.exportHeader(mesh), /inline constexpr float vertices/);
  // UV spans the polygon's own bounding box.
  assert.deepEqual([mesh.vertices[0].u, mesh.vertices[0].v], [0, 0]);
  assert.deepEqual([mesh.vertices[2].u, mesh.vertices[2].v], [1, 1]);
});

test("JSON roundtrip, including legacy files without new fields", () => {
  const shapes = [
    { id: 4, name: "A", color: "#ABCDEF", points: square, locked: true, groupId: 2 },
    { id: 9, name: "B", color: "#123456", points: ell },
  ];
  const json = G.serializeProject(shapes, { w: 800, h: 600 });
  const back = G.validateImport(JSON.parse(json));
  assert.equal(back.length, 2);
  assert.deepEqual(back[0].points, square);
  assert.equal(back[0].color, "#abcdef");
  assert.equal(back[0].locked, true);
  assert.equal(back[0].groupId, 2);
  assert.equal(back[1].hidden, undefined);
  const lower = shapes.map((s) => ({ ...s, color: s.color.toLowerCase() }));
  assert.equal(G.exportCpp(G.buildMesh(back)), G.exportCpp(G.buildMesh(lower)));
  const legacy = {
    format: "meshsketch-v1",
    viewport: { w: 800, h: 600 },
    shapes: [{ id: 1, name: "X", color: "#ff0000", points: square }],
  };
  assert.equal(G.validateImport(legacy).length, 1);
  assert.throws(() =>
    G.validateImport({ shapes: [{ name: "x", color: "red", points: square }] }),
  );
});
