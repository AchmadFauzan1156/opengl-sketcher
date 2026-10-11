import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./load.js";

const { MeshShortcuts: S } = load("shortcuts.js");

const ctx = (over = {}) => ({
  typing: false,
  textSelected: false,
  mode: "select",
  draftLength: 0,
  ...over,
});
const key = (k, mods = {}) => ({
  key: k,
  code: mods.code ?? "",
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});
const action = (e, c = ctx()) => S.resolve(e, c)?.action ?? null;

test("clipboard, selection and history shortcuts (Ctrl and Cmd)", () => {
  for (const m of [{ ctrl: true }, { meta: true }]) {
    assert.equal(action(key("c", m)), "copy");
    assert.equal(action(key("x", m)), "cut");
    assert.equal(action(key("v", m)), "paste");
    assert.equal(action(key("a", m)), "selectAll");
    assert.equal(action(key("d", m)), "duplicate");
    assert.equal(action(key("z", m)), "undo");
    assert.equal(action(key("Z", { ...m, shift: true })), "redo");
    assert.equal(action(key("g", m)), "group");
    assert.equal(action(key("G", { ...m, shift: true })), "ungroup");
    assert.equal(action(key("=", m)), "zoomIn");
    assert.equal(action(key("+", { ...m, shift: true })), "zoomIn");
    assert.equal(action(key("-", m)), "zoomOut");
    assert.equal(action(key("0", m)), "zoomReset");
  }
  assert.equal(action(key("y", { ctrl: true })), "redo");
  assert.equal(action(key("y", { meta: true })), null, "Cmd+Y is not hijacked");
});

test("focus inside text fields keeps native editing", () => {
  const typing = ctx({ typing: true });
  for (const e of [
    key("c", { ctrl: true }),
    key("v", { ctrl: true }),
    key("z", { ctrl: true }),
    key("a", { ctrl: true }),
    key("Backspace"),
    key("Delete"),
    key("v"),
    key("p"),
    key("ArrowLeft"),
  ])
    assert.equal(action(e, typing), null);
});

test("isTypingTarget distinguishes text fields from toggles", () => {
  assert.ok(S.isTypingTarget({ tagName: "INPUT", type: "text" }));
  assert.ok(S.isTypingTarget({ tagName: "INPUT", type: "number" }));
  assert.ok(S.isTypingTarget({ tagName: "TEXTAREA" }));
  assert.ok(S.isTypingTarget({ tagName: "DIV", isContentEditable: true }));
  assert.ok(!S.isTypingTarget({ tagName: "INPUT", type: "checkbox" }));
  assert.ok(!S.isTypingTarget({ tagName: "BUTTON" }));
  assert.ok(!S.isTypingTarget(null));
});

test("selected page text keeps native copy/cut", () => {
  const c = ctx({ textSelected: true });
  assert.equal(action(key("c", { ctrl: true }), c), null);
  assert.equal(action(key("x", { ctrl: true }), c), null);
});

test("context-aware Backspace/Delete", () => {
  assert.equal(action(key("Backspace")), "deleteSelection");
  assert.equal(action(key("Delete")), "deleteSelection");
  const drawing = ctx({ mode: "polygon", draftLength: 3 });
  assert.equal(action(key("Backspace"), drawing), "removeDraftPoint");
  assert.equal(action(key("Delete"), drawing), "removeDraftPoint");
  assert.equal(action(key("Backspace"), ctx({ mode: "polygon" })), "deleteSelection");
  assert.equal(action(key("Delete"), ctx({ vertexSelected: true })), "deleteVertex");
  assert.equal(action(key("Backspace"), ctx({ vertexSelected: true, mode: "polygon", draftLength: 2 })), "removeDraftPoint");
});

test("tools, escape, enter, nudge, fit", () => {
  assert.equal(action(key("v")), "toolSelect");
  assert.equal(action(key("V", { shift: true })), null);
  assert.equal(action(key("p")), "toolPolygon");
  assert.equal(action(key("Escape")), "escape");
  assert.equal(action(key("Enter")), null);
  assert.equal(action(key("Enter"), ctx({ mode: "polygon" })), "finishPolygon");
  assert.deepEqual(S.resolve(key("ArrowUp"), ctx()).args, { x: 0, y: 1, large: false });
  assert.deepEqual(S.resolve(key("ArrowLeft", { shift: true }), ctx()).args, { x: -1, y: 0, large: true });
  assert.equal(action(key("!", { shift: true, code: "Digit1" })), "fitView");
});

test("unrelated system/browser shortcuts are not hijacked", () => {
  for (const e of [
    key("r", { ctrl: true }),
    key("t", { ctrl: true }),
    key("w", { meta: true }),
    key("f", { ctrl: true }),
    key("c", { ctrl: true, alt: true }),
    key("Tab"),
    key("a"),
    key("F5"),
  ])
    assert.equal(action(e), null);
});

test("save/open project shortcuts", () => {
  assert.equal(action(key("s", { ctrl: true })), "save");
  assert.equal(action(key("o", { meta: true })), "open");
  assert.equal(action(key("s", { ctrl: true }), ctx({ typing: true })), null);
});
