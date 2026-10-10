"use strict";

// Each polygon owns its vertices so different flat colors never share vertex attributes.
// World coordinates use OpenGL NDC: left=-1, right=1, bottom=-1, top=1.
const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const frame = $("canvasFrame");
const EPS = 1e-8;
const SNAP = 0.05;
const MAX_SHAPES = 200;
const MAX_POINTS = 300;

let shapes = [];
let nextId = 1;
let selectedId = null;
let selectedVertex = null;
let mode = "select";
let draft = [];
let mouseWorld = null;
let dragging = null;
let history = [];
let future = [];
let dims = { w: 800, h: 600 };
let canvasSize = { w: 800, h: 600 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const near = (a, b) => Math.abs(a - b) < EPS;
const round = (value, digits = 5) => Number(value.toFixed(digits));
const clone = (obj) => JSON.parse(JSON.stringify(obj));
const chosen = () => shapes.find((shape) => shape.id === selectedId);
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
  if (points.some((p, i) => distance(p, points[(i + 1) % points.length]) < EPS))
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
// Output refers to each polygon's original vertex order.
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

function remember() {
  history.push(clone(shapes));
  if (history.length > 80) history.shift();
  future = [];
}
function restore(snapshot) {
  shapes = clone(snapshot);
  nextId = Math.max(0, ...shapes.map((shape) => shape.id)) + 1;
  if (!chosen()) selectedId = null;
  selectedVertex = null;
  updateAll();
}
function undo() {
  if (draft.length) {
    draft.pop();
    refreshDraft();
    render();
    return;
  }
  if (!history.length) return;
  future.push(clone(shapes));
  restore(history.pop());
}
function redo() {
  if (!future.length || draft.length) return;
  history.push(clone(shapes));
  restore(future.pop());
}

function setStatus(message) {
  $("editorStatus").textContent = message;
}
function setMode(newMode) {
  mode = newMode;
  $("selectModeBtn").classList.toggle("active", mode === "select");
  $("polygonModeBtn").classList.toggle("active", mode === "polygon");
  $("selectModeBtn").setAttribute("aria-pressed", String(mode === "select"));
  $("polygonModeBtn").setAttribute("aria-pressed", String(mode === "polygon"));
  frame.classList.toggle("selecting", mode === "select");
  if (mode !== "polygon") draft = [];
  refreshDraft();
  setStatus(
    mode === "polygon"
      ? "Klik canvas untuk menambahkan titik. Tekan Enter untuk menyelesaikan."
      : "Pilih titik atau tarik polygon untuk menggeser.",
  );
  render();
}
function refreshDraft() {
  $("draftActions").classList.toggle("hidden", mode !== "polygon");
  $("draftCount").textContent = `${draft.length} titik`;
  $("finishPolygonBtn").disabled = draft.length < 3;
}
function finishPolygon() {
  const error = validPolygon(draft);
  if (error) {
    setStatus(error);
    return;
  }
  try {
    triangulate(draft);
  } catch (err) {
    setStatus(err.message);
    return;
  }
  if (shapes.length >= MAX_SHAPES) {
    setStatus(`Maksimal ${MAX_SHAPES} polygon.`);
    return;
  }
  remember();
  const id = nextId++;
  shapes.push({
    id,
    name: `Polygon ${id}`,
    color: $("newColor").value,
    points: clone(draft),
  });
  selectedId = id;
  selectedVertex = null;
  setMode("select");
  setStatus("Polygon berhasil dibuat. Warna dapat diubah melalui panel kiri.");
  updateAll();
}
function cancelPolygon() {
  draft = [];
  refreshDraft();
  setMode("select");
}

function fromScreen(event, snap = $("snapToggle").checked) {
  const rect = canvas.getBoundingClientRect();
  const x = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
  const y = clamp(1 - ((event.clientY - rect.top) / rect.height) * 2, -1, 1);
  return {
    x: round(snap ? Math.round(x / SNAP) * SNAP : x),
    y: round(snap ? Math.round(y / SNAP) * SNAP : y),
  };
}
function toScreen(point) {
  return {
    x: ((point.x + 1) * canvasSize.w) / 2,
    y: ((1 - point.y) * canvasSize.h) / 2,
  };
}
function findVertex(event) {
  const mouse = {
    x: event.clientX - canvas.getBoundingClientRect().left,
    y: event.clientY - canvas.getBoundingClientRect().top,
  };
  for (let i = shapes.length - 1; i >= 0; i--) {
    const polygon = shapes[i];
    for (let j = polygon.points.length - 1; j >= 0; j--) {
      if (distance(mouse, toScreen(polygon.points[j])) <= 10)
        return { id: polygon.id, index: j };
    }
  }
  return null;
}
function findShape(world) {
  for (let i = shapes.length - 1; i >= 0; i--)
    if (pointInPolygon(world, shapes[i].points)) return shapes[i].id;
  return null;
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  canvas.focus();
  mouseWorld = fromScreen(event);
  if (mode === "polygon") {
    if (draft.length >= MAX_POINTS) {
      setStatus("Jumlah titik maksimum tercapai.");
      return;
    }
    if (draft.length && distance(draft[draft.length - 1], mouseWorld) < EPS) {
      setStatus("Titik tidak boleh sama dengan titik sebelumnya.");
      return;
    }
    draft.push(mouseWorld);
    refreshDraft();
    render();
    return;
  }
  const vertex = findVertex(event);
  if (vertex) {
    selectedId = vertex.id;
    selectedVertex = vertex.index;
    dragging = {
      type: "vertex",
      start: fromScreen(event),
      original: clone(chosen().points),
      changed: false,
    };
  } else {
    selectedId = findShape(fromScreen(event, false));
    selectedVertex = null;
    if (selectedId !== null)
      dragging = {
        type: "shape",
        start: fromScreen(event),
        original: clone(chosen().points),
        changed: false,
      };
  }
  if (dragging) canvas.setPointerCapture(event.pointerId);
  updateAll();
});
canvas.addEventListener("pointermove", (event) => {
  mouseWorld = fromScreen(event);
  $("cursorPosition").textContent =
    `X: ${mouseWorld.x.toFixed(2)}    Y: ${mouseWorld.y.toFixed(2)}`;
  if (dragging && chosen()) {
    const shape = chosen();
    if (dragging.type === "vertex") {
      const p = shape.points[selectedVertex];
      if (distance(p, mouseWorld) > EPS) {
        if (!dragging.changed) {
          remember();
          dragging.changed = true;
        }
        shape.points[selectedVertex] = { ...mouseWorld };
      }
    } else {
      let dx = mouseWorld.x - dragging.start.x;
      let dy = mouseWorld.y - dragging.start.y;
      const xs = dragging.original.map((p) => p.x),
        ys = dragging.original.map((p) => p.y);
      dx = clamp(dx, -1 - Math.min(...xs), 1 - Math.max(...xs));
      dy = clamp(dy, -1 - Math.min(...ys), 1 - Math.max(...ys));
      if (Math.abs(dx) > EPS || Math.abs(dy) > EPS) {
        if (!dragging.changed) {
          remember();
          dragging.changed = true;
        }
        shape.points = dragging.original.map((p) => ({
          x: round(p.x + dx),
          y: round(p.y + dy),
        }));
      }
    }
    render();
    updateExport();
    updateSelectedEditor();
  } else render();
});
function finishDragging() {
  if (!dragging) return;
  const wasChanged = dragging.changed;
  dragging = null;
  if (wasChanged) {
    const shape = chosen();
    let error = validPolygon(shape.points);
    if (!error) {
      try {
        triangulate(shape.points);
      } catch (err) {
        error = err.message;
      }
    }
    if (error) {
      restore(history.pop());
      future = [];
      setStatus(`Perubahan dibatalkan: ${error}`);
    } else {
      setStatus("Koordinat berhasil diperbarui.");
      updateAll();
    }
  }
}
canvas.addEventListener("pointerup", finishDragging);
canvas.addEventListener("pointercancel", finishDragging);
canvas.addEventListener("pointerleave", () => {
  if (!dragging) {
    mouseWorld = null;
    $("cursorPosition").textContent = "X: —    Y: —";
    render();
  }
});

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvasSize = { w: rect.width, h: rect.height };
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}
function drawPath(points, close = true) {
  points.forEach((p, i) => {
    const s = toScreen(p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  if (close) ctx.closePath();
}
function render() {
  const { w, h } = canvasSize;
  const dark = document.documentElement.dataset.theme === "dark";
  const palette = dark
    ? {
        background: "#111114",
        axis: "#52525b",
        major: "#313136",
        grid: "#242429",
        selected: "#fafafa",
        outline: "#a1a1aa",
        vertex: "#ffffff",
        selectedVertex: "#facc15",
        label: "#fafafa",
        draft: "#e4e4e7",
        draftPoint: "#fafafa",
      }
    : {
        background: "#ffffff",
        axis: "#a1a1aa",
        major: "#e4e4e7",
        grid: "#f4f4f5",
        selected: "#18181b",
        outline: "#3f3f4655",
        vertex: "#ffffff",
        selectedVertex: "#facc15",
        label: "#18181b",
        draft: "#18181b",
        draftPoint: "#18181b",
      };
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, w, h);
  if ($("gridToggle").checked) {
    ctx.lineWidth = 1;
    for (let i = -10; i <= 10; i++) {
      const val = i / 10;
      const x = ((val + 1) * w) / 2,
        y = ((1 - val) * h) / 2;
      ctx.strokeStyle =
        i === 0 ? palette.axis : i % 5 === 0 ? palette.major : palette.grid;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }
  for (const shape of shapes) {
    ctx.beginPath();
    drawPath(shape.points);
    ctx.fillStyle = shape.color;
    ctx.fill();
    ctx.strokeStyle =
      shape.id === selectedId ? palette.selected : palette.outline;
    ctx.lineWidth = shape.id === selectedId ? 2 : 1;
    ctx.stroke();
    if (shape.id === selectedId) {
      shape.points.forEach((p, index) => {
        const s = toScreen(p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, index === selectedVertex ? 6.5 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle =
          index === selectedVertex ? palette.selectedVertex : palette.vertex;
        ctx.fill();
        ctx.strokeStyle = palette.selected;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillStyle = palette.label;
        ctx.fillText(String(index), s.x + 9, s.y - 7);
      });
    }
  }
  if (draft.length) {
    ctx.beginPath();
    drawPath(draft, false);
    if (mouseWorld) {
      const p = toScreen(mouseWorld);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = palette.draft;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    draft.forEach((p, i) => {
      const s = toScreen(p);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = palette.draftPoint;
      ctx.fill();
      ctx.fillStyle = palette.label;
      ctx.font = "11px monospace";
      ctx.fillText(String(i), s.x + 9, s.y - 8);
    });
  }
  if (mouseWorld && mode === "polygon") {
    const s = toScreen(mouseWorld);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = palette.draft;
    ctx.fill();
  }
}

function updateShapeList() {
  const list = $("shapeList");
  list.replaceChildren();
  $("shapeCount").textContent = String(shapes.length);
  if (!shapes.length) {
    const t = document.createElement("p");
    t.className = "subtext";
    t.textContent = "Belum ada polygon.";
    list.append(t);
    return;
  }
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    const row = document.createElement("button");
    row.type = "button";
    row.className = "shape-item" + (selectedId === s.id ? " active" : "");
    const dot = document.createElement("span");
    dot.className = "shape-dot";
    dot.style.background = s.color;
    const content = document.createElement("span");
    content.className = "shape-caption";
    const title = document.createElement("strong");
    title.textContent = s.name;
    const sub = document.createElement("small");
    sub.textContent = `${s.points.length} titik · ${s.points.length - 2} segitiga`;
    content.append(title, sub);
    row.append(dot, content);
    row.addEventListener("click", () => {
      selectedId = s.id;
      selectedVertex = null;
      setMode("select");
      updateAll();
    });
    list.append(row);
  }
}
function updateSelectedEditor() {
  const s = chosen();
  $("selectedEditor").classList.toggle("hidden", !s);
  if (!s) return;
  if (document.activeElement !== $("shapeName")) $("shapeName").value = s.name;
  $("shapeColor").value = s.color;
  const index = shapes.findIndex((p) => p.id === selectedId);
  $("layerDownBtn").disabled = index <= 0;
  $("layerUpBtn").disabled = index >= shapes.length - 1;
  const hasVertex =
    Number.isInteger(selectedVertex) &&
    selectedVertex >= 0 &&
    selectedVertex < s.points.length;
  $("selectedVertexEditor").classList.toggle("hidden", !hasVertex);
  if (hasVertex) {
    $("selectedVertexIndex").textContent = `#${selectedVertex}`;
    if (document.activeElement !== $("vertexX"))
      $("vertexX").value = s.points[selectedVertex].x;
    if (document.activeElement !== $("vertexY"))
      $("vertexY").value = s.points[selectedVertex].y;
  }
}
function toFloat(v) {
  const str = (Math.abs(v) < 0.00005 ? 0 : v).toFixed(4);
  return `${str}f`;
}
function buildMesh() {
  const vertices = [],
    indices = [];
  for (const shape of shapes) {
    const triangles = triangulate(shape.points);
    const rgb = [1, 3, 5].map(
      (i) => parseInt(shape.color.slice(i, i + 2), 16) / 255,
    );
    const xs = shape.points.map((p) => p.x),
      ys = shape.points.map((p) => p.y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
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
function updateExport() {
  try {
    const mesh = buildMesh();
    $("codeOutput").value = mesh.vertices.length
      ? exportCpp(mesh)
      : "// Belum ada polygon. Pilih mode Polygon untuk mulai menggambar.";
    $("copyBtn").disabled = !mesh.vertices.length;
    $("cppDownloadBtn").disabled = !mesh.vertices.length;
    $("vertexCount").textContent = String(mesh.vertices.length);
    $("triangleCount").textContent = String(mesh.indices.length);
    $("indexCount").textContent = String(mesh.indices.length * 3);
  } catch (err) {
    $("codeOutput").value =
      `// ${err.message}\n// Perbaiki titik polygon sebelum mengekspor.`;
    $("vertexCount").textContent = "—";
    $("triangleCount").textContent = "—";
    $("indexCount").textContent = "—";
  }
  $("undoBtn").disabled = !history.length && !draft.length;
  $("redoBtn").disabled = !future.length || !!draft.length;
}
function updateAll() {
  updateShapeList();
  updateSelectedEditor();
  updateExport();
  render();
}
function editShape(callback) {
  const shape = chosen();
  if (!shape) return;
  remember();
  callback(shape);
  updateAll();
}
function editCoordinate(key, value) {
  const s = chosen();
  if (!s || selectedVertex === null) return;
  const n = Number(value);
  if (!Number.isFinite(n) || n < -1 || n > 1) {
    setStatus("Koordinat harus dari −1 sampai +1.");
    updateSelectedEditor();
    return;
  }
  if (near(s.points[selectedVertex][key], n)) return;
  const old = clone(s.points);
  s.points[selectedVertex][key] = round(n);
  let error = validPolygon(s.points);
  if (!error)
    try {
      triangulate(s.points);
    } catch (err) {
      error = err.message;
    }
  if (error) {
    s.points = old;
    setStatus(`Koordinat ditolak: ${error}`);
    updateSelectedEditor();
    return;
  }
  s.points = old;
  editShape((shape) => {
    shape.points[selectedVertex][key] = round(n);
  });
}
function applyViewport(value) {
  const [w, h] = value.split("x").map(Number);
  dims = { w, h };
  frame.style.setProperty("--canvas-ratio", `${w}/${h}`);
  frame.style.setProperty("--canvas-ratio-value", String(w / h));
  $("ratioLabel").textContent = `${w / gcd(w, h)}:${h / gcd(w, h)}`;
  setStatus(
    `Preview memakai rasio ${w}:${h}. Gunakan rasio yang sama pada OpenGL.`,
  );
  requestAnimationFrame(resizeCanvas);
}
function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function loadExample() {
  return [
    {
      id: 1,
      name: "Badan rumah",
      color: "#2563eb",
      points: [
        { x: -0.35, y: -0.55 },
        { x: 0.35, y: -0.55 },
        { x: 0.35, y: 0.18 },
        { x: -0.35, y: 0.18 },
      ],
    },
    {
      id: 2,
      name: "Atap",
      color: "#ef4444",
      points: [
        { x: -0.43, y: 0.18 },
        { x: 0.43, y: 0.18 },
        { x: 0, y: 0.68 },
      ],
    },
    {
      id: 3,
      name: "Pintu",
      color: "#f6c570",
      points: [
        { x: -0.09, y: -0.55 },
        { x: 0.09, y: -0.55 },
        { x: 0.09, y: -0.19 },
        { x: -0.09, y: -0.19 },
      ],
    },
  ];
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
    const points = s.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    const error = validPolygon(points);
    if (error) throw new Error(`Polygon ${i + 1}: ${error}`);
    triangulate(points);
    return {
      id: i + 1,
      name: s.name.slice(0, 60) || `Polygon ${i + 1}`,
      color: s.color.toLowerCase(),
      points,
    };
  });
}

function setTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("themeToggleBtn").setAttribute(
    "aria-label",
    dark ? "Aktifkan mode terang" : "Aktifkan mode gelap",
  );
  $("themeToggleBtn").setAttribute("aria-pressed", String(dark));
  $("themeIcon").innerHTML = dark
    ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>'
    : '<path d="M20.9 13.2A9 9 0 0 1 10.8 3.1 9 9 0 1 0 20.9 13.2Z"/>';
  render();
}
$("themeToggleBtn").addEventListener("click", () => {
  setTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  );
});

$("selectModeBtn").addEventListener("click", () => setMode("select"));
$("polygonModeBtn").addEventListener("click", () => setMode("polygon"));
$("finishPolygonBtn").addEventListener("click", finishPolygon);
$("cancelPolygonBtn").addEventListener("click", cancelPolygon);
$("newColor").addEventListener("input", () => {
  $("newColorHex").textContent = $("newColor").value.toUpperCase();
});
$("viewportSelect").addEventListener("change", (e) =>
  applyViewport(e.target.value),
);
$("gridToggle").addEventListener("change", render);
$("snapToggle").addEventListener("change", render);
$("undoBtn").addEventListener("click", () => {
  undo();
  updateExport();
});
$("redoBtn").addEventListener("click", redo);
$("shapeName").addEventListener("change", (e) => {
  const name = e.target.value.trim();
  if (name && chosen() && name !== chosen().name)
    editShape((s) => {
      s.name = name;
    });
});
$("shapeColor").addEventListener("change", (e) => {
  if (chosen() && e.target.value !== chosen().color)
    editShape((s) => {
      s.color = e.target.value;
    });
});
$("vertexX").addEventListener("change", (e) =>
  editCoordinate("x", e.target.value),
);
$("vertexY").addEventListener("change", (e) =>
  editCoordinate("y", e.target.value),
);
$("deleteBtn").addEventListener("click", () => {
  if (!chosen()) return;
  remember();
  shapes = shapes.filter((s) => s.id !== selectedId);
  selectedId = null;
  selectedVertex = null;
  updateAll();
});
$("duplicateBtn").addEventListener("click", () => {
  if (!chosen() || shapes.length >= MAX_SHAPES) return;
  const s = clone(chosen());
  const delta = 0.1;
  if (s.points.some((p) => p.x + delta > 1 || p.y - delta < -1)) {
    setStatus("Tidak cukup ruang untuk menduplikasi objek.");
    return;
  }
  remember();
  s.id = nextId++;
  s.name += " salinan";
  s.points = s.points.map((p) => ({
    x: round(p.x + delta),
    y: round(p.y - delta),
  }));
  shapes.push(s);
  selectedId = s.id;
  selectedVertex = null;
  updateAll();
});
function layerMove(offset) {
  const i = shapes.findIndex((s) => s.id === selectedId);
  const j = i + offset;
  if (i < 0 || j < 0 || j >= shapes.length) return;
  remember();
  [shapes[i], shapes[j]] = [shapes[j], shapes[i]];
  updateAll();
}
$("layerDownBtn").addEventListener("click", () => layerMove(-1));
$("layerUpBtn").addEventListener("click", () => layerMove(1));
$("resetBtn").addEventListener("click", () => {
  remember();
  shapes = loadExample();
  nextId = 4;
  selectedId = null;
  selectedVertex = null;
  draft = [];
  setMode("select");
  updateAll();
  setStatus("Contoh rumah telah dikembalikan.");
});
$("copyBtn").addEventListener("click", async () => {
  const value = $("codeOutput").value;
  try {
    if (navigator.clipboard && window.isSecureContext)
      await navigator.clipboard.writeText(value);
    else throw new Error("Clipboard API tidak tersedia");
    setStatus("Kode C++ berhasil disalin.");
  } catch {
    $("codeOutput").focus();
    $("codeOutput").select();
    const ok = document.execCommand("copy");
    setStatus(
      ok ? "Kode C++ berhasil disalin." : "Gunakan Ctrl+C untuk menyalin kode.",
    );
  }
});
$("cppDownloadBtn").addEventListener("click", () => {
  try {
    download("mesh_data.h", exportHeader(buildMesh()), "text/plain");
  } catch (err) {
    setStatus(err.message);
  }
});
$("jsonDownloadBtn").addEventListener("click", () =>
  download(
    "meshsketch.json",
    JSON.stringify(
      { format: "meshsketch-v1", viewport: dims, shapes },
      null,
      2,
    ),
    "application/json",
  ),
);
$("jsonImportBtn").addEventListener("click", () => $("jsonInput").click());
$("jsonInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024)
      throw new Error("JSON terlalu besar (maksimum 2 MB).");
    const data = JSON.parse(await file.text());
    const imported = validateImport(data);
    remember();
    shapes = imported;
    nextId = shapes.length + 1;
    selectedId = null;
    selectedVertex = null;
    draft = [];
    setMode("select");
    updateAll();
    if (
      data.viewport &&
      Number.isInteger(data.viewport.w) &&
      Number.isInteger(data.viewport.h)
    ) {
      const option = `${data.viewport.w}x${data.viewport.h}`;
      if ([...$("viewportSelect").options].some((o) => o.value === option)) {
        $("viewportSelect").value = option;
        applyViewport(option);
      }
    }
    setStatus("Project JSON berhasil dibuka.");
  } catch (err) {
    setStatus(`Gagal membuka JSON: ${err.message}`);
  }
  e.target.value = "";
});
$("pngDownloadBtn").addEventListener("click", () => {
  // Export clean artwork at the selected framebuffer resolution, without grid/handles.
  const output = document.createElement("canvas");
  output.width = dims.w;
  output.height = dims.h;
  const out = output.getContext("2d");
  out.fillStyle =
    document.documentElement.dataset.theme === "dark" ? "#111114" : "#ffffff";
  out.fillRect(0, 0, dims.w, dims.h);
  shapes.forEach((shape) => {
    out.beginPath();
    shape.points.forEach((p, i) => {
      const x = ((p.x + 1) * dims.w) / 2;
      const y = ((1 - p.y) * dims.h) / 2;
      if (i === 0) out.moveTo(x, y);
      else out.lineTo(x, y);
    });
    out.closePath();
    out.fillStyle = shape.color;
    out.fill();
  });
  output.toBlob((blob) => {
    if (!blob) {
      setStatus("Tidak bisa mengekspor PNG.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meshsketch-${dims.w}x${dims.h}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      updateExport();
    } else if (e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    }
    return;
  }
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
    document.activeElement?.tagName,
  );
  if (typing) return;
  if (e.key === "Escape" && mode === "polygon") {
    cancelPolygon();
  } else if (e.key === "Enter" && mode === "polygon") {
    e.preventDefault();
    finishPolygon();
  } else if (e.key === "Backspace" && mode === "polygon" && draft.length) {
    e.preventDefault();
    draft.pop();
    refreshDraft();
    render();
  }
});

shapes = loadExample();
nextId = 4;
applyViewport("800x600");
updateAll();
new ResizeObserver(resizeCanvas).observe(frame);
