import assert from "node:assert/strict";
import test from "node:test";
import { ALL_CONTROLS, CONTROL_GROUPS, controlsFor, formatKeys } from "../src/controls.js";

test("every control group and control has the required copy", () => {
  for (const group of CONTROL_GROUPS) {
    assert.ok(group.title.trim());
    assert.ok(group.controls.length > 0);

    for (const control of group.controls) {
      assert.ok(control.keys.length > 0);
      assert.ok(control.action.trim());
    }
  }
});

test("key names are unique within each control group", () => {
  for (const group of CONTROL_GROUPS) {
    const keys = group.controls.map((control) => formatKeys(control.keys, control.keyStyle).toLocaleLowerCase());
    assert.equal(new Set(keys).size, keys.length, `${group.id} repeats a key name`);
  }
});

test("formatKeys separates alternatives and chords readably", () => {
  assert.equal(formatKeys(["W", "↑"]), "W / ↑");
  assert.equal(formatKeys(["Ctrl", "Drag"], "chord"), "Ctrl + Drag");
});

test("controlsFor returns the matching group and null for an unknown id", () => {
  assert.equal(controlsFor("movement"), CONTROL_GROUPS[0]);
  assert.equal(controlsFor("missing-context"), null);
  assert.equal(ALL_CONTROLS.length, CONTROL_GROUPS.reduce((total, group) => total + group.controls.length, 0));
});
