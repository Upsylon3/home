// Tests for src/repeat.js (the wording of repeat choices).
import { test } from "node:test";
import assert from "node:assert/strict";
import { REPEAT_OPTIONS, describeRepeat } from "../src/repeat.js";

test("the dropdown offers every value the server accepts, 'none' first", () => {
  assert.deepEqual(
    REPEAT_OPTIONS.map((o) => o.value),
    ["none", "daily", "weekdays", "weekly", "monthly", "yearly"]
  );
});

test("describeRepeat words each repeat, and says nothing for a normal task", () => {
  assert.equal(describeRepeat("none"), null);
  assert.equal(describeRepeat(undefined), null);
  assert.equal(describeRepeat("daily"), "Repeats daily");
  assert.equal(describeRepeat("weekdays"), "Repeats on weekdays");
  assert.equal(describeRepeat("weekly"), "Repeats weekly");
  assert.equal(describeRepeat("monthly"), "Repeats monthly");
  assert.equal(describeRepeat("yearly"), "Repeats yearly");
});
