"use strict";

// Pure geometry + export helpers. No DOM access, so this file is also loaded by the Node tests.
// World coordinates use OpenGL NDC: left=-1, right=1, bottom=-1, top=1.
globalThis.MeshGeometry = (() => {
  const EPS = 1e-8;
  const MAX_SHAPES = 200;
  const MAX_POINTS = 300;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const near = (a, b) => Math.abs(a - b) < EPS;
  const round = (value, digits = 5) => {
    const r = Number(value.toFixed(digits));
    return r === 0 ? 0 : r; // avoid -0 in exports
  };
  const clone = (obj) => JSON.parse(JSON.stringify(obj));
  const signedArea = (points) =>
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2;
  const cross = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function intersect(a, b, c, d) {
    const orient = (p, q, r) => cross(p, q, r);
    const onSegment = (p, q, r) =>
      Math.min(p.x, q.x) - EPS <= r.x &&
      r.x <= Math.max(p.x, q.x) + EPS &&
      Math.min(p.y, q.y) - EPS <= r.y &&
      r.y <= Math.max(p.y, q.y) + EPS;
    const ab1 = orient(a, b, c),
      ab2 = orient(a, b, d),
      cd1 = orient(c, d, a),
      cd2 = orient(c, d, b);
    if (
      ((ab1 > EPS && ab2 < -EPS) || (ab1 < -EPS && ab2 > EPS)) &&
      ((cd1 > EPS && cd2 < -EPS) || (cd1 < -EPS && cd2 > EPS))
    )
      return true;
    return (
      (Math.abs(ab1) <= EPS && onSegment(a, b, c)) ||
      (Math.abs(ab2) <= EPS && onSegment(a, b, d)) ||
      (Math.abs(cd1) <= EPS && onSegment(c, d, a)) ||
      (Math.abs(cd2) <= EPS && onSegment(c, d, b))
    );
  }

  function validPolygon(points) {
    if (points.length < 3) return "Buat minimal 3 titik.";
    if (points.length > MAX_POINTS)
      return `Maksimal ${MAX_POINTS} titik per polygon.`;
    if (
      points.some(
        (p) =>
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          Math.abs(p.x) > 1 ||
          Math.abs(p.y) > 1,
      )
    )
      return "Koordinat harus berada pada rentang −1 sampai +1.";
    if (
      points.some((p, i) => distance(p, points[(i + 1) % points.length]) < EPS)
    )
      return "Ada dua titik bersebelahan yang sama.";
    if (Math.abs(signedArea(points)) < EPS) return "Luas polygon nol.";
    // Reject crossing edges, including overlapping/collinear segments.
    for (let i = 0; i < points.length; i++) {
      const iNext = (i + 1) % points.length;
      for (let j = i + 1; j < points.length; j++) {
        const jNext = (j + 1) % points.length;
        if (i === j || iNext === j || jNext === i) continue;
        if (intersect(points[i], points[iNext], points[j], points[jNext]))
          return "Polygon berpotongan dengan dirinya sendiri.";
      }
    }
    return null;
  }

  function pointInTriangle(p, a, b, c) {
    return (
      cross(a, b, p) >= -EPS && cross(b, c, p) >= -EPS && cross(c, a, p) >= -EPS
    );
  }

  // Ear clipping triangulation: handles simple convex and concave polygons.
  // Output refers to each polygon's original vertex order. Clockwise input is walked in
  // reverse, so emitted triangles are always counter-clockwise (OpenGL front faces) —
  // flips and mirrored scales therefore never change the exported triangle winding.
  function triangulate(points) {
    if (validPolygon(points)) throw new Error("Polygon tidak valid.");
    const remaining = points.map((_, i) => i);
    if (signedArea(points) < 0) remaining.reverse();
    const triangles = [];
    let guard = 0;
    while (remaining.length > 3) {
      let clipped = false;
      for (let j = 0; j < remaining.length; j++) {
        const prev = remaining[(j - 1 + remaining.length) % remaining.length];
        const cur = remaining[j];
        const next = remaining[(j + 1) % remaining.length];
        if (cross(points[prev], points[cur], points[next]) <= EPS) continue;
        if (
          remaining.some(
            (idx) =>
              idx !== prev &&
              idx !== cur &&
              idx !== next &&
              pointInTriangle(
                points[idx],
                points[prev],
                points[cur],
                points[next],
              ),
          )
        )
          continue;
        triangles.push([prev, cur, next]);
        remaining.splice(j, 1);
        clipped = true;
        break;
      }
      if (!clipped || guard++ > points.length * points.length)
        throw new Error("Polygon gagal ditriangulasi. Coba ubah posisi titik.");
    }
    if (
      cross(points[remaining[0]], points[remaining[1]], points[remaining[2]]) <=
      EPS
    )
      throw new Error("Ada segitiga dengan luas nol.");
    triangles.push([...remaining]);
    return triangles;
  }

  // Full integrity check used after every mutation: validation + triangulation.
  function checkPolygon(points) {
    const error = validPolygon(points);
    if (error) return error;
    try {
      triangulate(points);
    } catch (err) {
      return err.message;
    }
    return null;
  }

  function pointInPolygon(p, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i],
        b = points[j];
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
    return inside;
  }

  // ---- Bounds & rigid/affine transforms (all operate on NDC model coordinates) ----

  function bounds(points) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      minX,
      minY,
      maxX,
      maxY,
      w: maxX - minX,
      h: maxY - minY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    };
  }
  const shapesBounds = (shapes) => bounds(shapes.flatMap((s) => s.points));

  const roundPoints = (points) =>
    points.map((p) => ({ x: round(p.x), y: round(p.y) }));

  function translatePoints(points, dx, dy) {
    return roundPoints(points.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  }

  // Standard counter-clockwise rotation matrix [cos −sin; sin cos] around pivot.
  // `aspect` = viewport width / height. NDC is stretched by the viewport, so the rotation
  // is done in viewport-pixel space (x scaled by aspect) to keep on-screen proportions;
  // with aspect 1 this is the plain NDC rotation.
  function rotatePoints(points, radians, pivot, aspect = 1) {
    const c = Math.cos(radians),
      s = Math.sin(radians);
    return roundPoints(
      points.map((p) => {
        const x = (p.x - pivot.x) * aspect,
          y = p.y - pivot.y;
        return { x: pivot.x + (x * c - y * s) / aspect, y: pivot.y + x * s + y * c };
      }),
    );
  }

  function scalePoints(points, sx, sy, anchor) {
    return roundPoints(
      points.map((p) => ({
        x: anchor.x + (p.x - anchor.x) * sx,
        y: anchor.y + (p.y - anchor.y) * sy,
      })),
    );
  }

  // Largest translation ≤ (dx, dy) keeping box b inside NDC. Rigid: never distorts.
  function clampDelta(b, dx, dy) {
    return {
      dx: clamp(dx, -1 - b.minX, 1 - b.maxX),
      dy: clamp(dy, -1 - b.minY, 1 - b.maxY),
    };
  }

  function rectContainsPoints(rect, points) {
    const minX = Math.min(rect.x1, rect.x2),
      maxX = Math.max(rect.x1, rect.x2),
      minY = Math.min(rect.y1, rect.y2),
      maxY = Math.max(rect.y1, rect.y2);
    return points.every(
      (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY,
    );
  }

  // ---- OpenGL export (8 floats per vertex: xyz + rgb + uv) ----

  function toFloat(v) {
    const str = (Math.abs(v) < 0.00005 ? 0 : v).toFixed(4);
    return `${str}f`;
  }
  // UVs are a planar projection of each polygon's bounding box, recomputed from the
  // current positions, so rotate/scale/flip can never leave stale texture coordinates.
  function buildMesh(shapes) {
    const vertices = [],
      indices = [];
    for (const shape of shapes) {
      if (shape.hidden) continue;
      const triangles = triangulate(shape.points);
      const rgb = [1, 3, 5].map(
        (i) => parseInt(shape.color.slice(i, i + 2), 16) / 255,
      );
      const { minX, maxX, minY, maxY } = bounds(shape.points);
      const start = vertices.length;
      shape.points.forEach((p) => {
        const u = maxX - minX > EPS ? (p.x - minX) / (maxX - minX) : 0;
        const v = maxY - minY > EPS ? (p.y - minY) / (maxY - minY) : 0;
        vertices.push({ x: p.x, y: p.y, z: 0, rgb, u, v, name: shape.name });
      });
      for (const tri of triangles)
        indices.push({ i: tri.map((x) => x + start), name: shape.name });
    }
    return { vertices, indices };
  }
  function exportCpp(mesh) {
    const lines = ["float vertices[] = {"];
    mesh.vertices.forEach((v, i) => {
      const fields = [v.x, v.y, v.z, ...v.rgb, v.u, v.v].map(toFloat);
      lines.push(
        `    ${fields.slice(0, 3).join(", ")},  ${fields.slice(3, 6).join(", ")},  ${fields.slice(6).join(", ")}, // ${i} · ${v.name}`,
      );
    });
    lines.push("};", "", "unsigned int indices[] = {");
    mesh.indices.forEach((tri) =>
      lines.push(`    ${tri.i.join(", ")}, // ${tri.name}`),
    );
    lines.push("};");
    return lines.join("\n");
  }
  function exportHeader(mesh) {
    if (!mesh.vertices.length) return "#pragma once\n// Tidak ada polygon.\n";
    const arrays = exportCpp(mesh)
      .split("\n// Drawing (after VAO/EBO setup):")[0]
      .replace("float vertices[] = {", "inline constexpr float vertices[] = {")
      .replace(
        "unsigned int indices[] = {",
        "inline constexpr unsigned int indices[] = {",
      );
    return `#pragma once\n\n${arrays}\n`;
  }

  // ---- JSON project format (meshsketch-v1; hidden/locked/groupId are optional) ----

  function serializeProject(shapes, viewport) {
    return JSON.stringify(
      {
        format: "meshsketch-v1",
        viewport,
        shapes: shapes.map((s) => {
          const out = { id: s.id, name: s.name, color: s.color, points: s.points };
          if (s.hidden) out.hidden = true;
          if (s.locked) out.locked = true;
          if (s.groupId != null) out.groupId = s.groupId;
          return out;
        }),
      },
      null,
      2,
    );
  }

  function validateImport(project) {
    if (
      !project ||
      !Array.isArray(project.shapes) ||
      project.shapes.length > MAX_SHAPES
    )
      throw new Error("JSON harus memiliki array shapes yang valid.");
    return project.shapes.map((s, i) => {
      if (
        !s ||
        typeof s.name !== "string" ||
        typeof s.color !== "string" ||
        !/^#[0-9a-fA-F]{6}$/.test(s.color) ||
        !Array.isArray(s.points)
      )
        throw new Error(`Format polygon ${i + 1} salah.`);
      const points = s.points.map((p) => ({ x: Number(p?.x), y: Number(p?.y) }));
      const error = validPolygon(points);
      if (error) throw new Error(`Polygon ${i + 1}: ${error}`);
      triangulate(points);
      const shape = {
        id: i + 1,
        name: s.name.slice(0, 60) || `Polygon ${i + 1}`,
        color: s.color.toLowerCase(),
        points,
      };
      if (s.hidden === true) shape.hidden = true;
      if (s.locked === true) shape.locked = true;
      if (Number.isInteger(s.groupId)) shape.groupId = s.groupId;
      return shape;
    });
  }

  return {
    EPS,
    MAX_SHAPES,
    MAX_POINTS,
    clamp,
    near,
    round,
    clone,
    signedArea,
    cross,
    distance,
    intersect,
    validPolygon,
    triangulate,
    checkPolygon,
    pointInPolygon,
    bounds,
    shapesBounds,
    translatePoints,
    rotatePoints,
    scalePoints,
    clampDelta,
    rectContainsPoints,
    toFloat,
    buildMesh,
    exportCpp,
    exportHeader,
    serializeProject,
    validateImport,
  };
})();
