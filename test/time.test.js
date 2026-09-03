import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSlotRange,
  dateKeyInDays,
  dateTimeLabel,
  isoFromMoscow,
  moscowDateKey,
  parseScheduleText,
  parseSingleTime,
  timeLabel,
} from "../src/time.js";

test("московское время корректно переводится в UTC и обратно", () => {
  const iso = isoFromMoscow("2026-08-16", "14:30");
  assert.equal(iso, "2026-08-16T11:30:00.000Z");
  assert.equal(moscowDateKey(iso), "2026-08-16");
  assert.equal(timeLabel(iso), "14:30");
  assert.match(dateTimeLabel(iso), /16 августа.+14:30/);
});

test("даты считаются в московском часовом поясе", () => {
  assert.equal(dateKeyInDays(0, new Date("2026-08-16T21:30:00Z")), "2026-08-17");
  assert.equal(dateKeyInDays(1, new Date("2026-12-31T20:00:00Z")), "2027-01-01");
});

test("готовая смена разбивается на окна", () => {
  const slots = buildSlotRange("2026-08-20", "10:00", "13:00", 60);
  assert.equal(slots.length, 3);
  assert.equal(timeLabel(slots[0].startsAt), "10:00");
  assert.equal(timeLabel(slots[2].endsAt), "13:00");
});

test("распознаётся ручной формат графика", () => {
  assert.deepEqual(parseScheduleText("10:00–20:00 60"), {
    startTime: "10:00",
    endTime: "20:00",
    stepMinutes: 60,
  });
  assert.deepEqual(parseSingleTime("9:30 90"), { time: "09:30", duration: 90 });
  assert.throws(() => parseScheduleText("с десяти до восьми"), /формат/);
});

test("некорректная дата и обратная смена отклоняются", () => {
  assert.throws(() => isoFromMoscow("2026-02-30", "10:00"), /дата/);
  assert.throws(() => buildSlotRange("2026-08-20", "20:00", "10:00", 60), /позже/);
});

