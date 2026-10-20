import { test } from "node:test";
import assert from "node:assert/strict";
import { isoDate, date, retention, canTrain, esc } from "../web/domain.js";
test("dates display Gregorian dd/mm/yyyy and reject impossible dates", () => {
  assert.equal(date("2026-10-19T00:00:00Z"), "19/10/2026");
  assert.equal(isoDate("19/10/2026"), "2026-10-19");
  assert.throws(() => isoDate("31/02/2026"));
  assert.throws(() => isoDate("2026-10-19"));
});
test("retention cohort includes first day and excludes day 91 and future starts", () => {
  const r = retention(
    [
      {
        actual_start_date: "2026-07-22",
        resignation_date: null,
        employment_status: "ACTIVE",
      },
      {
        actual_start_date: "2026-07-21",
        resignation_date: null,
        employment_status: "ACTIVE",
      },
      {
        actual_start_date: "2026-10-19",
        resignation_date: "2026-10-19",
        employment_status: "RESIGNED",
      },
      {
        actual_start_date: "2026-10-20",
        resignation_date: null,
        employment_status: "ACTIVE",
      },
    ],
    "2026-10-19",
  );
  assert.equal(r.total, 2);
  assert.equal(r.active, 1);
  assert.equal(r.rate, 50);
  assert.equal(retention([]).rate, null);
});
test("coach and manager scopes are distinct; generated HTML escapes user input", () => {
  const a = { hiring_unit: "A", coach_id: "one" };
  assert.equal(canTrain("COACH", [], a, "two", "COACH"), false);
  assert.equal(canTrain("COACH", [], a, "one", "SAFETY"), false);
  assert.equal(canTrain("MANAGER", ["B"], a, "x", "GENERAL"), false);
  assert.equal(canTrain("SAFETY", [], a, "x", "SAFETY"), true);
  assert.equal(esc("<script>"), "&lt;script&gt;");
});
