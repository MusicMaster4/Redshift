import { describe, expect, test } from "vitest";

import { createSchedule } from "../types";
import { curveValue, scheduleOffsets, validateSchedule } from "./schedule";

describe("schedule timeline", () => {
  test("rolls later anchors into tomorrow", () => {
    const schedule = createSchedule();
    expect(scheduleOffsets(schedule)).toEqual([1170, 1215, 1815, 1860]);
  });

  test("requires a day and a valid duration", () => {
    const schedule = createSchedule();
    expect(validateSchedule(schedule)).toBeNull();
    schedule.days = schedule.days.map(() => false);
    expect(validateSchedule(schedule)).toContain("day");
  });

  test("fade curves keep their endpoints", () => {
    for (const curve of ["linear", "smooth", "gentle"] as const) {
      expect(curveValue(curve, 0)).toBe(0);
      expect(curveValue(curve, 1)).toBe(1);
    }
    expect(curveValue("smooth", 0.5)).toBeCloseTo(0.5);
  });
});
