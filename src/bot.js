import {
  addSlots,
  appointmentById,
  calendarSummary,
  cancelAppointment,
  clearFreeSlotsForDate,
  clearSession,
  clientAppointments,
  completeAppointment,
  createAppointment,
  createManualAppointment,
  dueReminders,
  freeDateKeys,
  freeSlotsForDate,
  getSession,
  markReminderSent,
  ownerAppointments,
  ownerBySlot,
  ownerUsers,
  rescheduleAppointment,
  savePhone,
  setSession,
  slotById,
  upsertUser,
  userByChat,
} from "./db.js";
import {
  addMinutes,
  buildSlotRange,
  dateKeyInDays,
  dateLabel,
  dateTimeLabel,
  futureDateKeys,
  isoFromMoscow,
  moscowDateKey,
  parseScheduleText,
  parseSingleTime,
  timeLabel,
} from "./time.js";
import {
  appointmentClientKeyboard,
  appointmentOwnerKeyboard,
  clientHomeKeyboard,
  commandName,
  daysKeyboard,
  displayName,
  escapeHtml,
  ownerHomeKeyboard,
  parseManualClient,
  rescheduleSlotsKeyboard,
  schedulePresetsKeyboard,
  slotsKeyboard,
  startParameter,
} from "./ui.js";
import {
  answerCallback,
  editMessage,
  removeReplyKeyboard,
  sendMessage,
  TelegramError,
} from "./telegram.js";

function clientHomeText(env, user) {
  const title = env.BARBER_NAME
    ? `Онлайн-запись: ${escapeHtml(env.BARBER_NAME)}`
    : "Онлайн-запись к барберу";
  return [
    `💈 <b>${title}</b>`,
    "",
    `Здравствуйте, <b>${escapeHtml(user.display_name)}</b>!`,
    "Выберите удобное свободное время — подтверждение придёт сразу сюда.",
  ].join("\n");
}

function ownerHomeText(env) {
  const title = env.BARBER_NAME
    ? `Кабинет барбера: ${escapeHtml(env.BARBER_NAME)}`
    : "Кабинет барбера";
  return [
    `✂️ <b>${title}</b>`,
    "",
    "Здесь можно опубликовать свободное время, посмотреть клиентов и управлять записями.",
  ].join("\n");
}

async function showHome(env, chatId, role, messageId = null) {
  const user = await userByChat(env, chatId);
  const text = role === "owner" ? ownerHomeText(env) : clientHomeText(env, user);
  const keyboard = role === "owner" ? ownerHomeKeyboard() : clientHomeKeyboard();
  if (messageId) return editMessage(env, chatId, messageId, text, keyboard);
  return sendMessage(env, chatId, text, { reply_markup: keyboard });
}

function contactKeyboard() {
  return {
    keyboard: [
      [{ text: "📱 Поделиться номером", request_contact: true }],
      [{ text: "Не сейчас" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "Номер увидит только мастер",
  };
}

function contactLine(appointment) {
  const phone = appointment.current_phone || appointment.client_phone;
  const username = appointment.current_username ? `@${appointment.current_username}` : null;
  return [phone ? `📞 ${escapeHtml(phone)}` : null, username ? `Telegram: ${escapeHtml(username)}` : null]
    .filter(Boolean)
    .join("\n") || (appointment.source === "manual"
      ? "📞 Контакт не указан"
      : "Контакт: ответить клиенту можно через уведомление Telegram");
}

function appointmentText(appointment, forOwner = false) {
  const statusNames = {
    booked: "подтверждена",
    cancelled: "отменена",
    completed: "завершена",
    no_show: "не состоялась",
  };
  const lines = [
    `${appointment.status === "booked" ? "✅" : "ℹ️"} <b>Запись ${statusNames[appointment.status] || appointment.status}</b>`,
    "",
    `🗓 ${escapeHtml(dateTimeLabel(appointment.starts_at))}`,
  ];
  if (forOwner) {
    lines.push(`👤 ${escapeHtml(appointment.client_name)}`, contactLine(appointment));
  }
  return lines.join("\n");
}

async function safeSend(env, chatId, text, extra = {}) {
  try {
    await sendMessage(env, chatId, text, extra);
  } catch (error) {
    if (error instanceof TelegramError && error.status === 403) {
      await env.DB.prepare("UPDATE users SET active = 0 WHERE chat_id = ?").bind(chatId).run();
      return;
    }
    console.error("Notification failed", { chatId, message: error?.message });
  }
}

async function notifyOwners(env, text, excludeChatId = null) {
  const owners = await ownerUsers(env);
  await Promise.all(owners.filter((owner) => owner.chat_id !== excludeChatId).map((owner) => safeSend(
    env,
    owner.chat_id,
    text,
    { reply_markup: ownerHomeKeyboard() },
  )));
}

async function kickReminderScheduler(env) {
  if (!env.REMINDER_SCHEDULER) return;
  try {
    const id = env.REMINDER_SCHEDULER.idFromName("booking-reminders");
    const stub = env.REMINDER_SCHEDULER.get(id);
    await stub.fetch("https://reminder-scheduler.internal/kick");
  } catch (error) {
    console.error("Reminder scheduler kick failed", { message: error?.message });
  }
}

async function showBookingDates(env, chatId, messageId) {
  const keys = await freeDateKeys(env);
  if (!keys.length) {
    return editMessage(env, chatId, messageId, [
      "📅 <b>Свободное время</b>",
      "",
      "Пока нет свободных окон. Загляните чуть позже — мастер добавляет их сюда сам.",
    ].join("\n"), { inline_keyboard: [[{ text: "🔄 Проверить снова", callback_data: "book:start" }], [{ text: "◀️ В меню", callback_data: "home" }]] });
  }
  return editMessage(
    env,
    chatId,
    messageId,
    "📅 <b>Выберите удобный день</b>",
    daysKeyboard("date", keys, 45),
  );
}

async function showSlots(env, chatId, messageId, dateKey) {
  const rows = await freeSlotsForDate(env, dateKey);
  if (!rows.length) {
    return editMessage(env, chatId, messageId, [
      `<b>${escapeHtml(dateLabel(dateKey, true))}</b>`,
      "",
      "Свободные окна уже разобрали. Выберите другую дату.",
    ].join("\n"), { inline_keyboard: [[{ text: "◀️ К другим датам", callback_data: "book:start" }]] });
  }
  return editMessage(
    env,
    chatId,
    messageId,
    `🗓 <b>${escapeHtml(dateLabel(dateKey, true))}</b>\n\nВыберите время:`,
    slotsKeyboard(rows),
  );
}

async function showClientAppointments(env, chatId, messageId) {
  const rows = await clientAppointments(env, chatId);
  if (!rows.length) {
    return editMessage(env, chatId, messageId, "📅 <b>Предстоящих записей нет</b>\n\nСамое время выбрать удобное окно.", {
      inline_keyboard: [[{ text: "✂️ Записаться", callback_data: "book:start" }], [{ text: "◀️ В меню", callback_data: "home" }]],
    });
  }
  return editMessage(env, chatId, messageId, "📅 <b>Мои записи</b>\n\nНажмите на запись, чтобы перенести или отменить её.", {
    inline_keyboard: [
      ...rows.map((row) => [{
        text: `${dateLabel(moscowDateKey(row.starts_at))} · ${timeLabel(row.starts_at)}`,
        callback_data: `capp:${row.id}`,
      }]),
      [{ text: "◀️ В меню", callback_data: "home" }],
    ],
  });
}

async function showOwnerAppointments(env, chatId, messageId) {
  const rows = await ownerAppointments(env);
  if (!rows.length) {
    return editMessage(env, chatId, messageId, "👥 <b>Предстоящих записей пока нет</b>", {
      inline_keyboard: [[{ text: "➕ Добавить время", callback_data: "owner:schedule" }], [{ text: "◀️ В меню", callback_data: "home" }]],
    });
  }
  return editMessage(env, chatId, messageId, "👥 <b>Предстоящие записи</b>\n\nБлижайшие показаны первыми:", {
    inline_keyboard: [
      ...rows.map((row) => [{
        text: `${dateLabel(moscowDateKey(row.starts_at))} · ${timeLabel(row.starts_at)} · ${row.client_name}`,
        callback_data: `oapp:${row.id}`,
      }]),
      [{ text: "◀️ В меню", callback_data: "home" }],
    ],
  });
}

async function publishSlots(env, chatId, dateKey, slots) {
  const result = await addSlots(env, slots);
  await clearSession(env, chatId);
  return sendMessage(env, chatId, [
    "✅ <b>Свободное время опубликовано</b>",
    "",
    `🗓 ${escapeHtml(dateLabel(dateKey, true))}`,
    `Добавлено окон: <b>${result.added}</b>${result.added < result.total ? ` (ещё ${result.total - result.added} уже были в графике)` : ""}.`,
    "Клиенты уже видят их в разделе записи.",
  ].join("\n"), { reply_markup: ownerHomeKeyboard() });
}

async function handleOwnerText(message, env, user, text) {
  const session = await getSession(env, message.chat.id);
  if (!session) return false;
  if (session.flow === "schedule_custom") {
    try {
      const parsed = parseScheduleText(text);
      const slots = buildSlotRange(session.data.dateKey, parsed.startTime, parsed.endTime, parsed.stepMinutes);
      await publishSlots(env, message.chat.id, session.data.dateKey, slots);
    } catch (error) {
      await sendMessage(env, message.chat.id, `Не получилось: ${escapeHtml(error.message)}\n\nПример: <code>10:00–20:00 60</code>\nЧтобы выйти, отправьте /cancel.`);
    }
    return true;
  }
  if (session.flow === "schedule_single") {
    try {
      const parsed = parseSingleTime(text);
      const startsAt = isoFromMoscow(session.data.dateKey, parsed.time);
      await publishSlots(env, message.chat.id, session.data.dateKey, [{ startsAt, endsAt: addMinutes(startsAt, parsed.duration) }]);
    } catch (error) {
      await sendMessage(env, message.chat.id, `Не получилось: ${escapeHtml(error.message)}\n\nПример: <code>14:30</code> или <code>14:30 90</code>.`);
    }
    return true;
  }
  if (session.flow === "manual_booking") {
    try {
      const client = parseManualClient(text);
      const appointment = await createManualAppointment(env, {
        slotId: Number(session.data.slotId),
        clientName: client.name,
        clientPhone: client.phone,
        bookedByChatId: message.chat.id,
      });
      await clearSession(env, message.chat.id);
      if (!appointment) {
        await sendMessage(env, message.chat.id, "Это время уже занято или больше недоступно. Откройте расписание и выберите другое окно.", { reply_markup: ownerHomeKeyboard() });
        return true;
      }

      await sendMessage(env, message.chat.id, [
        "✅ <b>Клиент записан</b>",
        "",
        `🗓 ${escapeHtml(dateTimeLabel(appointment.starts_at))}`,
        `👤 ${escapeHtml(appointment.client_name)}`,
        contactLine(appointment),
      ].join("\n"), { reply_markup: appointmentOwnerKeyboard(appointment.id) });
      await notifyOwners(env, [
        "📝 <b>Администратор добавил запись</b>",
        "",
        `🗓 ${escapeHtml(dateTimeLabel(appointment.starts_at))}`,
        `👤 ${escapeHtml(appointment.client_name)}`,
        contactLine(appointment),
        `Добавил: ${escapeHtml(user.display_name)}`,
      ].join("\n"), message.chat.id);
      await kickReminderScheduler(env);
    } catch (error) {
      await sendMessage(env, message.chat.id, [
        `Не получилось: ${escapeHtml(error.message)}`,
        "",
        "Отправьте <code>Имя</code> или <code>Имя, телефон</code>.",
        "Чтобы выйти, отправьте /cancel.",
      ].join("\n"));
    }
    return true;
  }
  return false;
}

async function handleMessage(message, env) {
  if (message.chat?.type !== "private") {
    return sendMessage(env, message.chat.id, `Откройте бота в личном чате: @${escapeHtml(env.BOT_USERNAME)}`);
  }

  const text = message.text?.trim() ?? "";
  const command = commandName(text);
  let user = await userByChat(env, message.chat.id);

  if (command === "/start") {
    const suppliedCode = startParameter(text);
    let requestedSlot = null;
    if (suppliedCode && env.OWNER_CODE && suppliedCode === env.OWNER_CODE) requestedSlot = "primary";
    if (suppliedCode && env.BACKUP_OWNER_CODE && suppliedCode === env.BACKUP_OWNER_CODE) requestedSlot = "backup";
    const slotOwner = requestedSlot ? await ownerBySlot(env, requestedSlot) : null;
    const actorUserId = message.from?.id ?? message.chat.id;
    const currentSlotIsCompatible = !user?.admin_slot || user.admin_slot === requestedSlot;
    const slotIsAvailable = !slotOwner || slotOwner.user_id === actorUserId;
    const canBecomeOwner = Boolean(requestedSlot && currentSlotIsCompatible && slotIsAvailable);
    user = await upsertUser(
      env,
      message,
      canBecomeOwner ? "owner" : null,
      canBecomeOwner ? requestedSlot : null,
    );
    await clearSession(env, message.chat.id);

    if (user.role === "owner") {
      await removeReplyKeyboard(env, message.chat.id, `Добро пожаловать, <b>${escapeHtml(user.display_name)}</b>! Режим барбера активирован.`);
      return showHome(env, message.chat.id, "owner");
    }

    await sendMessage(env, message.chat.id, [
      `Здравствуйте, <b>${escapeHtml(user.display_name)}</b>!`,
      "Чтобы мастеру было проще связаться с вами, можно поделиться номером. Он не показывается другим клиентам.",
    ].join("\n"), { reply_markup: contactKeyboard() });
    return showHome(env, message.chat.id, "client");
  }

  if (!user) user = await upsertUser(env, message);
  else user = await upsertUser(env, message, user.role);

  if (message.contact) {
    if (message.contact.user_id && message.contact.user_id !== message.from?.id) {
      return sendMessage(env, message.chat.id, "Пожалуйста, отправьте именно свой контакт кнопкой ниже.", { reply_markup: contactKeyboard() });
    }
    await savePhone(env, message.chat.id, message.contact.phone_number);
    await removeReplyKeyboard(env, message.chat.id, "✅ Номер сохранён. Его увидит только мастер в вашей записи.");
    return showHome(env, message.chat.id, user.role);
  }

  if (text === "Не сейчас") {
    await removeReplyKeyboard(env, message.chat.id, "Хорошо. Записаться можно и без номера — мастер увидит ваше имя в Telegram.");
    return showHome(env, message.chat.id, user.role);
  }

  if (command === "/cancel") {
    await clearSession(env, message.chat.id);
    await sendMessage(env, message.chat.id, "Текущее действие отменено.");
    return showHome(env, message.chat.id, user.role);
  }

  if (user.role === "owner" && await handleOwnerText(message, env, user, text)) return;

  if (["/menu", "/help"].includes(command)) return showHome(env, message.chat.id, user.role);
  if (text.startsWith("/")) return sendMessage(env, message.chat.id, "Неизвестная команда. Нажмите /menu.");
  return showHome(env, message.chat.id, user.role);
}

async function handleClientCallback(callback, env, ctx, user, data, chatId, messageId) {
  if (data === "book:start") return showBookingDates(env, chatId, messageId);
  if (data === "client:help") {
    return editMessage(env, chatId, messageId, [
      "❓ <b>Как записаться</b>",
      "",
      "1. Нажмите «Записаться».",
      "2. Выберите свободную дату и время.",
      "3. Подтвердите запись. Стоимость мастер сообщит лично.",
      "",
      "В «Моих записях» приём можно перенести или отменить. Напоминания придут за 24 часа и за 2 часа.",
    ].join("\n"), { inline_keyboard: [[{ text: "✂️ Записаться", callback_data: "book:start" }], [{ text: "◀️ В меню", callback_data: "home" }]] });
  }
  if (data === "client:appointments") return showClientAppointments(env, chatId, messageId);

  let match = /^date:(\d{4}-\d{2}-\d{2})$/.exec(data);
  if (match) return showSlots(env, chatId, messageId, match[1]);

  match = /^slot:(\d+)$/.exec(data);
  if (match) {
    const slot = await slotById(env, Number(match[1]));
    if (!slot || !slot.available) {
      await sendMessage(env, chatId, "Это время только что заняли. Показываю оставшиеся варианты.");
      return showBookingDates(env, chatId, messageId);
    }
    return editMessage(env, chatId, messageId, [
      "🔎 <b>Проверьте запись</b>",
      "",
      `🗓 ${escapeHtml(dateTimeLabel(slot.starts_at))}`,
      "",
      "Всё верно?",
    ].join("\n"), { inline_keyboard: [[{ text: "✅ Подтвердить", callback_data: `confirm:${slot.id}` }], [{ text: "◀️ Выбрать другое время", callback_data: "book:start" }]] });
  }

  match = /^confirm:(\d+)$/.exec(data);
  if (match) {
    const appointment = await createAppointment(env, {
      slotId: Number(match[1]),
      client: user,
    });
    if (!appointment) {
      await sendMessage(env, chatId, "Это окно уже занято. Выберите другое.");
      return showBookingDates(env, chatId, messageId);
    }
    const text = `${appointmentText(appointment)}\n\nНапоминания придут за 24 часа и за 2 часа.`;
    await editMessage(env, chatId, messageId, text, appointmentClientKeyboard(appointment.id));
    ctx.waitUntil(notifyOwners(env, [
      "🆕 <b>Новая запись</b>",
      "",
      `🗓 ${escapeHtml(dateTimeLabel(appointment.starts_at))}`,
      `👤 ${escapeHtml(appointment.client_name)}`,
      contactLine(appointment),
    ].join("\n")));
    ctx.waitUntil(kickReminderScheduler(env));
    if (!user.phone) {
      await sendMessage(env, chatId, "Хотите оставить мастеру номер для связи?", { reply_markup: contactKeyboard() });
    }
    return;
  }

  match = /^capp:(\d+)$/.exec(data);
  if (match) {
    const appointment = await appointmentById(env, Number(match[1]));
    if (!appointment || appointment.client_chat_id !== chatId) return showClientAppointments(env, chatId, messageId);
    const keyboard = appointment.status === "booked" ? appointmentClientKeyboard(appointment.id) : { inline_keyboard: [[{ text: "◀️ Мои записи", callback_data: "client:appointments" }]] };
    return editMessage(env, chatId, messageId, appointmentText(appointment), keyboard);
  }

  match = /^reschedule:(\d+)$/.exec(data);
  if (match) {
    const appointment = await appointmentById(env, Number(match[1]));
    if (!appointment || appointment.client_chat_id !== chatId || appointment.status !== "booked") return showClientAppointments(env, chatId, messageId);
    const keys = await freeDateKeys(env);
    if (!keys.length) return sendMessage(env, chatId, "Сейчас нет других свободных окон.");
    return editMessage(env, chatId, messageId, `🔁 <b>Перенос записи</b>\n\nТекущее время: ${escapeHtml(dateTimeLabel(appointment.starts_at))}\nВыберите новый день:`, daysKeyboard(`rdate:${appointment.id}`, keys, 45));
  }

  match = /^rdate:(\d+):(\d{4}-\d{2}-\d{2})$/.exec(data);
  if (match) {
    const appointment = await appointmentById(env, Number(match[1]));
    if (!appointment || appointment.client_chat_id !== chatId || appointment.status !== "booked") return showClientAppointments(env, chatId, messageId);
    const slots = await freeSlotsForDate(env, match[2]);
    if (!slots.length) return sendMessage(env, chatId, "На этот день свободных окон уже нет.");
    return editMessage(env, chatId, messageId, `🔁 <b>Выберите новое время</b>\n\n${escapeHtml(dateLabel(match[2], true))}`, rescheduleSlotsKeyboard(slots, appointment.id));
  }

  match = /^rslot:(\d+):(\d+)$/.exec(data);
  if (match) {
    const [appointment, slot] = await Promise.all([
      appointmentById(env, Number(match[1])),
      slotById(env, Number(match[2])),
    ]);
    if (!appointment || appointment.client_chat_id !== chatId || !slot?.available) return sendMessage(env, chatId, "Это время уже недоступно.");
    return editMessage(env, chatId, messageId, [
      "🔎 <b>Подтвердите перенос</b>",
      "",
      `Было: ${escapeHtml(dateTimeLabel(appointment.starts_at))}`,
      `Будет: <b>${escapeHtml(dateTimeLabel(slot.starts_at))}</b>`,
    ].join("\n"), { inline_keyboard: [[{ text: "✅ Перенести", callback_data: `rebook:${appointment.id}:${slot.id}` }], [{ text: "◀️ Назад", callback_data: `reschedule:${appointment.id}` }]] });
  }

  match = /^rebook:(\d+):(\d+)$/.exec(data);
  if (match) {
    const before = await appointmentById(env, Number(match[1]));
    if (!before || before.client_chat_id !== chatId) return showClientAppointments(env, chatId, messageId);
    const updated = await rescheduleAppointment(env, before.id, Number(match[2]), chatId);
    if (!updated) return sendMessage(env, chatId, "Новое время уже заняли. Попробуйте ещё раз.");
    await editMessage(env, chatId, messageId, `✅ <b>Запись перенесена</b>\n\n${appointmentText(updated).replace(/^✅ <b>Запись подтверждена<\/b>\n\n/, "")}`, appointmentClientKeyboard(updated.id));
    ctx.waitUntil(notifyOwners(env, [
      "🔁 <b>Клиент перенёс запись</b>",
      "",
      `👤 ${escapeHtml(updated.client_name)}`,
      `Было: ${escapeHtml(dateTimeLabel(before.starts_at))}`,
      `Стало: <b>${escapeHtml(dateTimeLabel(updated.starts_at))}</b>`,
    ].join("\n")));
    ctx.waitUntil(kickReminderScheduler(env));
    return;
  }
  return false;
}

async function handleOwnerCallback(callback, env, ctx, user, data, chatId, messageId) {
  if (data === "owner:schedule") {
    return editMessage(env, chatId, messageId, "➕ <b>Добавить свободное время</b>\n\nВыберите день:", daysKeyboard("sched", null, 21));
  }
  if (data === "owner:appointments") return showOwnerAppointments(env, chatId, messageId);
  if (data === "owner:calendar") {
    return editMessage(env, chatId, messageId, "🗓 <b>Расписание</b>\n\nВыберите день:", daysKeyboard("cal", null, 21));
  }
  if (data === "owner:settings") {
    return editMessage(env, chatId, messageId, [
      "⚙️ <b>Настройки</b>",
      "",
      `Ссылка для клиентов: https://t.me/${escapeHtml(env.BOT_USERNAME)}`,
      "Режим барбера защищён личной ссылкой и уже привязан к вашему Telegram.",
      "",
      "Стоимость приёма мастер сообщает клиенту индивидуально.",
    ].join("\n"), { inline_keyboard: [[{ text: "◀️ В меню", callback_data: "home" }]] });
  }

  let match = /^manual:(\d+)$/.exec(data);
  if (match) {
    const slot = await slotById(env, Number(match[1]));
    if (!slot?.available || slot.status !== "free") {
      return sendMessage(env, chatId, "Это время уже занято. Откройте расписание и выберите другое окно.");
    }
    await setSession(env, chatId, "manual_booking", { slotId: slot.id });
    return sendMessage(env, chatId, [
      `👤 <b>Запись клиента на ${escapeHtml(dateTimeLabel(slot.starts_at))}</b>`,
      "",
      "Отправьте имя клиента одним сообщением:",
      "<code>Иван</code>",
      "",
      "Если хотите сохранить телефон:",
      "<code>Иван, +7 999 123-45-67</code>",
      "",
      "Для выхода — /cancel.",
    ].join("\n"));
  }

  match = /^sched:(\d{4}-\d{2}-\d{2})$/.exec(data);
  if (match) {
    return editMessage(env, chatId, messageId, `➕ <b>${escapeHtml(dateLabel(match[1], true))}</b>\n\nВыберите готовый график или введите свой:`, schedulePresetsKeyboard(match[1]));
  }

  match = /^preset:(\d{4}-\d{2}-\d{2}):(\d{2}):(\d{2}):(30|60)$/.exec(data);
  if (match) {
    const slots = buildSlotRange(match[1], `${match[2]}:00`, `${match[3]}:00`, Number(match[4]));
    const result = await addSlots(env, slots);
    return editMessage(env, chatId, messageId, [
      "✅ <b>Свободное время опубликовано</b>",
      "",
      `🗓 ${escapeHtml(dateLabel(match[1], true))}`,
      `Добавлено окон: <b>${result.added}</b>${result.added < result.total ? `, уже существовало: ${result.total - result.added}` : ""}.`,
    ].join("\n"), ownerHomeKeyboard());
  }

  match = /^custom:(\d{4}-\d{2}-\d{2})$/.exec(data);
  if (match) {
    await setSession(env, chatId, "schedule_custom", { dateKey: match[1] });
    return sendMessage(env, chatId, [
      `✍️ <b>Свой график на ${escapeHtml(dateLabel(match[1], true))}</b>`,
      "",
      "Отправьте начало, конец и шаг в минутах:",
      "<code>10:00–20:00 60</code>",
      "",
      "Допустимый шаг: 30, 45, 60, 90 или 120 минут. Для выхода — /cancel.",
    ].join("\n"));
  }

  match = /^single:(\d{4}-\d{2}-\d{2})$/.exec(data);
  if (match) {
    await setSession(env, chatId, "schedule_single", { dateKey: match[1] });
    return sendMessage(env, chatId, [
      `🕐 <b>Одно окно на ${escapeHtml(dateLabel(match[1], true))}</b>`,
      "",
      "Отправьте время. При желании через пробел укажите длительность:",
      "<code>14:30</code> или <code>14:30 90</code>",
    ].join("\n"));
  }

  match = /^clearask:(\d{4}-\d{2}-\d{2})$/.exec(data);
  if (match) {
    return editMessage(env, chatId, messageId, `Убрать все <b>свободные</b> окна на ${escapeHtml(dateLabel(match[1], true))}? Уже занятые записи останутся.`, {
      inline_keyboard: [[{ text: "🧹 Да, убрать", callback_data: `clear:${match[1]}` }], [{ text: "◀️ Назад", callback_data: `sched:${match[1]}` }]],
    });
  }

  match = /^clear:(\d{4}-\d{2}-\d{2})$/.exec(data);
  if (match) {
    const count = await clearFreeSlotsForDate(env, match[1]);
    return editMessage(env, chatId, messageId, `🧹 Убрано свободных окон: <b>${count}</b>. Записи клиентов сохранены.`, ownerHomeKeyboard());
  }

  match = /^cal:(\d{4}-\d{2}-\d{2})$/.exec(data);
  if (match) {
    const rows = await calendarSummary(env, match[1]);
    const text = rows.length ? [
      `🗓 <b>${escapeHtml(dateLabel(match[1], true))}</b>`,
      "",
      ...rows.map((row) => row.appointment_id
        ? `👤 <b>${timeLabel(row.starts_at)}</b> · ${escapeHtml(row.client_name)}`
        : `${row.status === "blocked" ? "⛔" : "▫️"} <b>${timeLabel(row.starts_at)}</b> · свободно`),
    ].join("\n") : `🗓 <b>${escapeHtml(dateLabel(match[1], true))}</b>\n\nГрафик на этот день ещё не опубликован.`;
    const slotButtons = rows
      .filter((row) => row.appointment_id || (
        row.status === "free"
        && new Date(row.starts_at).getTime() > Date.now() + 15 * 60 * 1000
      ))
      .map((row) => [{
        text: row.appointment_id
          ? `Открыть ${timeLabel(row.starts_at)} · ${row.client_name}`
          : `👤 Записать ${timeLabel(row.starts_at)}`,
        callback_data: row.appointment_id ? `oapp:${row.appointment_id}` : `manual:${row.id}`,
      }]);
    return editMessage(env, chatId, messageId, text, {
      inline_keyboard: [
        ...slotButtons,
        [{ text: "➕ Добавить время", callback_data: `sched:${match[1]}` }],
        [{ text: "◀️ К датам", callback_data: "owner:calendar" }],
      ],
    });
  }

  match = /^oapp:(\d+)$/.exec(data);
  if (match) {
    const appointment = await appointmentById(env, Number(match[1]));
    if (!appointment) return showOwnerAppointments(env, chatId, messageId);
    const keyboard = appointment.status === "booked" ? appointmentOwnerKeyboard(appointment.id) : { inline_keyboard: [[{ text: "◀️ Все записи", callback_data: "owner:appointments" }]] };
    return editMessage(env, chatId, messageId, appointmentText(appointment, true), keyboard);
  }

  match = /^complete:(\d+)$/.exec(data);
  if (match) {
    const changed = await completeAppointment(env, Number(match[1]));
    if (!changed) await sendMessage(env, chatId, "Запись уже была изменена.");
    return showOwnerAppointments(env, chatId, messageId);
  }
  return false;
}

async function handleSharedCallback(callback, env, ctx, user, data, chatId, messageId) {
  if (data === "home") return showHome(env, chatId, user.role, messageId);

  let match = /^cancelask:(\d+):(client|owner)$/.exec(data);
  if (match) {
    if (match[2] !== user.role) return sendMessage(env, chatId, "Недостаточно прав для этого действия.");
    const appointment = await appointmentById(env, Number(match[1]));
    if (!appointment || appointment.status !== "booked" || (user.role === "client" && appointment.client_chat_id !== chatId)) {
      return sendMessage(env, chatId, "Запись уже была изменена.");
    }
    return editMessage(env, chatId, messageId, [
      "⚠️ <b>Отменить запись?</b>",
      "",
      `🗓 ${escapeHtml(dateTimeLabel(appointment.starts_at))}`,
    ].join("\n"), { inline_keyboard: [[{ text: "❌ Да, отменить", callback_data: `cancel:${appointment.id}:${user.role}` }], [{ text: "◀️ Нет, оставить", callback_data: `${user.role === "owner" ? "oapp" : "capp"}:${appointment.id}` }]] });
  }

  match = /^cancel:(\d+):(client|owner)$/.exec(data);
  if (match) {
    if (match[2] !== user.role) return sendMessage(env, chatId, "Недостаточно прав для этого действия.");
    const appointment = await appointmentById(env, Number(match[1]));
    if (!appointment || (user.role === "client" && appointment.client_chat_id !== chatId)) {
      return sendMessage(env, chatId, "Запись не найдена.");
    }
    const changed = await cancelAppointment(env, appointment.id, user.role, chatId);
    if (!changed) return sendMessage(env, chatId, "Запись уже была изменена.");
    await editMessage(env, chatId, messageId, `❌ <b>Запись отменена</b>\n\n🗓 ${escapeHtml(dateTimeLabel(appointment.starts_at))}`, user.role === "owner" ? ownerHomeKeyboard() : clientHomeKeyboard());
    if (user.role === "client") {
      ctx.waitUntil(notifyOwners(env, [
        "❌ <b>Клиент отменил запись</b>",
        "",
        `👤 ${escapeHtml(appointment.client_name)}`,
        `🗓 ${escapeHtml(dateTimeLabel(appointment.starts_at))}`,
      ].join("\n")));
    } else if (appointment.source !== "manual") {
      ctx.waitUntil(safeSend(env, appointment.client_chat_id, [
        "❌ <b>Мастер отменил запись</b>",
        "",
        `🗓 ${escapeHtml(dateTimeLabel(appointment.starts_at))}`,
        "",
        "Пожалуйста, выберите другое удобное время.",
      ].join("\n"), { reply_markup: { inline_keyboard: [[{ text: "✂️ Выбрать другое время", callback_data: "book:start" }]] } }));
    }
    return true;
  }
  return false;
}

async function handleCallback(callback, env, ctx) {
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  if (!chatId || !messageId) return answerCallback(env, callback.id);

  const user = await userByChat(env, chatId);
  if (!user) {
    await answerCallback(env, callback.id, "Сначала нажмите /start", true);
    return;
  }

  const data = callback.data ?? "";
  if (data === "noop") return answerCallback(env, callback.id);

  await answerCallback(env, callback.id);
  if (await handleSharedCallback(callback, env, ctx, user, data, chatId, messageId)) return;

  const handled = user.role === "owner"
    ? await handleOwnerCallback(callback, env, ctx, user, data, chatId, messageId)
    : await handleClientCallback(callback, env, ctx, user, data, chatId, messageId);
  if (handled === false) {
    await sendMessage(env, chatId, "Эта кнопка устарела. Откройте /menu.");
  }
}

export async function handleTelegramUpdate(update, env, ctx) {
  if (update.message) return handleMessage(update.message, env);
  if (update.callback_query) return handleCallback(update.callback_query, env, ctx);
}

export async function deliverDueReminders(env) {
  const owners = await ownerUsers(env);
  for (const hours of [24, 2]) {
    const rows = await dueReminders(env, hours);
    for (const appointment of rows) {
      const when = hours === 24 ? "меньше чем через сутки" : "через 2 часа";
      if (appointment.source !== "manual") {
        await safeSend(env, appointment.client_chat_id, [
          `⏰ <b>Напоминание: запись ${when}</b>`,
          "",
          `🗓 ${escapeHtml(dateTimeLabel(appointment.starts_at))}`,
          "",
          "Если планы изменились, откройте /menu → «Мои записи».",
        ].join("\n"));
      }
      for (const owner of owners) {
        await safeSend(env, owner.chat_id, [
          `⏰ <b>Приём ${when}</b>`,
          "",
          `🗓 ${escapeHtml(dateTimeLabel(appointment.starts_at))}`,
          `👤 ${escapeHtml(appointment.client_name)}`,
        ].join("\n"));
      }
      await markReminderSent(env, appointment.id, hours);
    }
  }
}
