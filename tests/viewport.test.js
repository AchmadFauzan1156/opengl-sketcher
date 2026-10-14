import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./load.js";

const { MeshViewport: V } = load("viewport.js");
const size = { w: 800, h: 600 };
const closeTo = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("100% zoom keeps the original NDC mapping", () => {
  const v = V.create();
  assert.deepEqual(V.worldToScreen(v, size, { x: -1, y: 1 }), { x: 0, y: 0 });
  assert.deepEqual(V.worldToScreen(v, size, { x: 1, y: -1 }), { x: 800, y: 600 });
  assert.deepEqual(V.worldToScreen(v, size, { x: 0, y: 0 }), { x: 400, y: 300 });
});

test("screen/world conversion is consistent at any zoom and pan", () => {
  const v = V.create();
  for (const scale of [0.25, 0.5, 1, 3, 8]) {
    V.zoomAt(v, scale, { x: 123, y: 456 });
    V.pan(v, 17, -31);
    for (const p of [
      { x: 0.3, y: -0.7 },
      { x: -1, y: 1 },
      { x: 0.05, y: 0.95 },
    ]) {
      const back = V.screenToWorld(v, size, V.worldToScreen(v, size, p));
      closeTo(back.x, p.x);
      closeTo(back.y, p.y);
    }
  }
});

test("zoom keeps the world point under the cursor fixed", () => {
  const v = V.create();
  const cursor = { x: 610, y: 145 };
  const before = V.screenToWorld(v, size, cursor);
  V.zoomAt(v, 3, cursor);
  const after = V.screenToWorld(v, size, cursor);
  closeTo(before.x, after.x);
  closeTo(before.y, after.y);
  const c2 = { x: 10, y: 590 };
  V.zoomAt(v, 0.5, c2);
  const a1 = V.screenToWorld(v, size, c2);
  V.zoomAt(v, 6, c2);
  const a2 = V.screenToWorld(v, size, c2);
  closeTo(a1.x, a2.x);
  closeTo(a1.y, a2.y);
});

test("zoom clamps to 25%–800% and steps through presets", () => {
  const v = V.create();
  V.zoomAt(v, 100, { x: 0, y: 0 });
  assert.equal(v.scale, 8);
  V.zoomAt(v, 0.01, { x: 0, y: 0 });
  assert.equal(v.scale, 0.25);
  assert.equal(V.stepScale(1, 1), 1.25);
  assert.equal(V.stepScale(1, -1), 0.75);
  assert.equal(V.stepScale(1.1, 1), 1.25);
  assert.equal(V.stepScale(8, 1), 8);
  assert.equal(V.stepScale(0.25, -1), 0.25);
});

test("reset and fit to view", () => {
  const v = V.create();
  V.zoomAt(v, 4, { x: 50, y: 50 });
  V.reset(v);
  assert.deepEqual(v, { scale: 1, offsetX: 0, offsetY: 0 });
  const b = { minX: 0, maxX: 0.2, minY: 0, maxY: 0.1, w: 0.2, h: 0.1, cx: 0.1, cy: 0.05 };
  V.fit(v, size, b, 40);
  const tl = V.worldToScreen(v, size, { x: b.minX, y: b.maxY });
  const br = V.worldToScreen(v, size, { x: b.maxX, y: b.minY });
  assert.ok(tl.x >= 40 - 1e-6 && br.x <= 760 + 1e-6);
  assert.ok(tl.y >= 40 - 1e-6 && br.y <= 560 + 1e-6);
  const c = V.worldToScreen(v, size, { x: b.cx, y: b.cy });
  closeTo(c.x, 400, 1e-6);
  closeTo(c.y, 300, 1e-6);
  V.fit(v, size, null);
  assert.deepEqual(v, { scale: 1, offsetX: 0, offsetY: 0 });
});

test("resize keeps the framed world region", () => {
  const v = V.create();
  V.zoomAt(v, 2, { x: 200, y: 100 });
  const p = { x: 0.4, y: 0.4 };
  const s1 = V.worldToScreen(v, size, p);
  const big = { w: 1600, h: 1200 };
  V.resize(v, size, big);
  const s2 = V.worldToScreen(v, big, p);
  closeTo(s2.x, s1.x * 2, 1e-6);
  closeTo(s2.y, s1.y * 2, 1e-6);
});
