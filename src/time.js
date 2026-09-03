export const MOSCOW_OFFSET_MINUTES = 180;

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const WEEKDAYS_LONG = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function pad(value) {
  return String(value).padStart(2, "0");
}

export function moscowParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const shifted = new Date(date.getTime() + MOSCOW_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export function moscowDateKey(value = new Date()) {
  const part = moscowParts(value);
  return `${part.year}-${pad(part.month)}-${pad(part.day)}`;
}

export function isoFromMoscow(dateKey, timeText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(timeText)) {
    throw new Error("Некорректные дата или время");
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeText.split(":").map(Number);
  if (hour > 23 || minute > 59) throw new Error("Некорректное время");
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute) - MOSCOW_OFFSET_MINUTES * 60_000);
  const check = moscowParts(utc);
  if (check.year !== year || check.month !== month || check.day !== day || check.hour !== hour || check.minute !== minute) {
    throw new Error("Некорректная дата");
  }
  return utc.toISOString();
}

export function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function dateKeyInDays(days, now = new Date()) {
  const part = moscowParts(now);
  const moscowMidnightAsUtc = Date.UTC(part.year, part.month - 1, part.day);
  const target = new Date(moscowMidnightAsUtc + days * 86_400_000);
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`;
}

export function dateLabel(dateKey, long = false) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return long
    ? `${day} ${MONTHS[month - 1]}, ${WEEKDAYS_LONG[weekday]}`
    : `${pad(day)}.${pad(month)} · ${WEEKDAYS[weekday]}`;
}

export function timeLabel(iso) {
  const part = moscowParts(iso);
  return `${pad(part.hour)}:${pad(part.minute)}`;
}

export function dateTimeLabel(iso) {
  return `${dateLabel(moscowDateKey(iso), true)} в ${timeLabel(iso)}`;
}

export function futureDateKeys(count = 21, now = new Date()) {
  return Array.from({ length: count }, (_, index) => dateKeyInDays(index, now));
}

export function buildSlotRange(dateKey, startTime, endTime, stepMinutes) {
  if (![30, 45, 60, 90, 120].includes(Number(stepMinutes))) {
    throw new Error("Шаг должен быть 30, 45, 60, 90 или 120 минут");
  }
  const start = isoFromMoscow(dateKey, startTime);
  const end = isoFromMoscow(dateKey, endTime);
  if (new Date(end) <= new Date(start)) throw new Error("Конец смены должен быть позже начала");

  const slots = [];
  for (let cursor = start; new Date(addMinutes(cursor, stepMinutes)) <= new Date(end); cursor = addMinutes(cursor, stepMinutes)) {
    slots.push({ startsAt: cursor, endsAt: addMinutes(cursor, stepMinutes) });
  }
  if (!slots.length || slots.length > 40) throw new Error("Получилось недопустимое количество окон");
  return slots;
}

export function parseScheduleText(text) {
  const match = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})(?:\s+(30|45|60|90|120))?$/.exec(text.trim());
  if (!match) throw new Error("Используйте формат: 10:00–20:00 60");
  const startTime = `${pad(Number(match[1]))}:${match[2]}`;
  const endTime = `${pad(Number(match[3]))}:${match[4]}`;
  const stepMinutes = Number(match[5] ?? 60);
  return { startTime, endTime, stepMinutes };
}

export function parseSingleTime(text) {
  const match = /^(\d{1,2}):(\d{2})(?:\s+(30|45|60|90|120))?$/.exec(text.trim());
  if (!match) throw new Error("Используйте формат: 14:30 или 14:30 90");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("Некорректное время");
  return { time: `${pad(hour)}:${pad(minute)}`, duration: Number(match[3] ?? 60) };
}

