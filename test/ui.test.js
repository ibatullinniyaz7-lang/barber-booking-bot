import test from "node:test";
import assert from "node:assert/strict";

import {
  clientHomeKeyboard,
  commandName,
  daysKeyboard,
  escapeHtml,
  parseManualClient,
  schedulePresetsKeyboard,
  slotsKeyboard,
  startParameter,
} from "../src/ui.js";

test("динамический текст экранируется для Telegram HTML", () => {
  assert.equal(escapeHtml('<Мастер & "гости">'), "&lt;Мастер &amp; &quot;гости&quot;&gt;");
});

test("команды и защищённый start-параметр разбираются", () => {
  assert.equal(commandName("/MENU@sample_booking_bot"), "/menu");
  assert.equal(startParameter("/start owner_secret"), "owner_secret");
});

test("основное меню содержит запись и управление приёмами", () => {
  const keyboard = clientHomeKeyboard();
  const callbacks = keyboard.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(callbacks.includes("book:start"));
  assert.ok(callbacks.includes("client:appointments"));
});

test("клавиатуры генерируют callback_data короче лимита Telegram", () => {
  const keyboards = [
    daysKeyboard("rdate:123456789", null, 21),
    schedulePresetsKeyboard("2026-08-16"),
    slotsKeyboard([{ id: 9999, starts_at: "2026-08-16T09:00:00.000Z" }]),
  ];
  for (const button of keyboards.flatMap((keyboard) => keyboard.inline_keyboard.flat())) {
    assert.ok(Buffer.byteLength(button.callback_data, "utf8") <= 64, button.callback_data);
  }
});

test("ручная запись принимает имя и необязательный телефон", () => {
  assert.deepEqual(parseManualClient("Иван"), { name: "Иван", phone: null });
  assert.deepEqual(parseManualClient("Иван, +7 999 123-45-67"), {
    name: "Иван",
    phone: "+7 999 123-45-67",
  });
  assert.throws(() => parseManualClient("   "), /Укажите имя/);
});
