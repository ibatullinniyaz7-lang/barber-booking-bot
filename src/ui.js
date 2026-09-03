import { dateLabel, futureDateKeys, timeLabel } from "./time.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function displayName(user = {}) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return fullName || (user.username ? `@${user.username}` : `Telegram ${user.id ?? ""}`.trim());
}

export function commandName(text = "") {
  return text.trim().split(/\s+/, 1)[0].split("@", 1)[0].toLocaleLowerCase("ru-RU");
}

export function startParameter(text = "") {
  const parts = text.trim().split(/\s+/);
  return parts.length > 1 ? parts[1] : "";
}

export function parseManualClient(text = "") {
  const value = text.trim();
  if (!value) throw new Error("Укажите имя клиента.");

  const [rawName, ...contactParts] = value.split(/[,\n]/);
  const name = rawName.trim();
  const phone = contactParts.join(" ").trim() || null;
  if (!name) throw new Error("Укажите имя клиента.");
  if (name.length > 80) throw new Error("Имя слишком длинное.");
  if (phone && phone.length > 40) throw new Error("Номер телефона слишком длинный.");
  return { name, phone };
}

export function clientHomeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "✂️ Записаться", callback_data: "book:start" }],
      [{ text: "📅 Мои записи", callback_data: "client:appointments" }],
      [{ text: "❓ Помощь", callback_data: "client:help" }],
    ],
  };
}

export function ownerHomeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "➕ Добавить свободное время", callback_data: "owner:schedule" }],
      [
        { text: "🗓 Расписание", callback_data: "owner:calendar" },
        { text: "👥 Записи", callback_data: "owner:appointments" },
      ],
      [{ text: "⚙️ Настройки и ссылка", callback_data: "owner:settings" }],
    ],
  };
}

export function daysKeyboard(prefix, availableDateKeys = null, count = 21) {
  const allowed = availableDateKeys ? new Set(availableDateKeys) : null;
  const keys = futureDateKeys(count).filter((key) => !allowed || allowed.has(key));
  const rows = [];
  for (let index = 0; index < keys.length; index += 2) {
    rows.push(keys.slice(index, index + 2).map((key) => ({
      text: dateLabel(key),
      callback_data: `${prefix}:${key}`,
    })));
  }
  rows.push([{ text: "◀️ Назад", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

export function slotsKeyboard(slots) {
  const buttons = slots.map((slot) => ({
    text: timeLabel(slot.starts_at),
    callback_data: `slot:${slot.id}`,
  }));
  const rows = [];
  for (let index = 0; index < buttons.length; index += 3) rows.push(buttons.slice(index, index + 3));
  rows.push([{ text: "◀️ К другим датам", callback_data: "book:start" }]);
  return { inline_keyboard: rows };
}

export function rescheduleSlotsKeyboard(slots, appointmentId) {
  const buttons = slots.map((slot) => ({
    text: timeLabel(slot.starts_at),
    callback_data: `rslot:${appointmentId}:${slot.id}`,
  }));
  const rows = [];
  for (let index = 0; index < buttons.length; index += 3) rows.push(buttons.slice(index, index + 3));
  rows.push([{ text: "◀️ К записи", callback_data: `capp:${appointmentId}` }]);
  return { inline_keyboard: rows };
}

export function schedulePresetsKeyboard(dateKey) {
  return {
    inline_keyboard: [
      [{ text: "10:00–20:00 · 60 мин", callback_data: `preset:${dateKey}:10:20:60` }],
      [{ text: "10:00–20:00 · 30 мин", callback_data: `preset:${dateKey}:10:20:30` }],
      [{ text: "12:00–22:00 · 60 мин", callback_data: `preset:${dateKey}:12:22:60` }],
      [
        { text: "🕐 Одно окно", callback_data: `single:${dateKey}` },
        { text: "✍️ Свой график", callback_data: `custom:${dateKey}` },
      ],
      [{ text: "🧹 Убрать свободные окна", callback_data: `clearask:${dateKey}` }],
      [{ text: "◀️ Другая дата", callback_data: "owner:schedule" }],
    ],
  };
}

export function appointmentClientKeyboard(appointmentId) {
  return {
    inline_keyboard: [
      [{ text: "🔁 Перенести", callback_data: `reschedule:${appointmentId}` }],
      [{ text: "❌ Отменить запись", callback_data: `cancelask:${appointmentId}:client` }],
      [{ text: "◀️ Мои записи", callback_data: "client:appointments" }],
    ],
  };
}

export function appointmentOwnerKeyboard(appointmentId) {
  return {
    inline_keyboard: [
      [{ text: "✅ Приём завершён", callback_data: `complete:${appointmentId}` }],
      [{ text: "❌ Отменить запись", callback_data: `cancelask:${appointmentId}:owner` }],
      [{ text: "◀️ Все записи", callback_data: "owner:appointments" }],
    ],
  };
}
