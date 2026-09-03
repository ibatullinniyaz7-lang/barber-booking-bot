export async function claimUpdate(env, updateId) {
  if (!Number.isInteger(updateId)) return true;
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO processed_updates (update_id, processed_at) VALUES (?, CURRENT_TIMESTAMP)",
  ).bind(updateId).run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function releaseUpdate(env, updateId) {
  if (!Number.isInteger(updateId)) return;
  await env.DB.prepare("DELETE FROM processed_updates WHERE update_id = ?").bind(updateId).run();
}

export function userByChat(env, chatId) {
  return env.DB.prepare("SELECT * FROM users WHERE chat_id = ? LIMIT 1").bind(chatId).first();
}

export async function ownerUsers(env) {
  const result = await env.DB.prepare(
    "SELECT * FROM users WHERE role = 'owner' AND active = 1 ORDER BY CASE admin_slot WHEN 'primary' THEN 0 ELSE 1 END, created_at",
  ).all();
  return result.results ?? [];
}

export function ownerBySlot(env, adminSlot) {
  return env.DB.prepare(
    "SELECT * FROM users WHERE role = 'owner' AND admin_slot = ? LIMIT 1",
  ).bind(adminSlot).first();
}

export async function upsertUser(env, message, role = null, adminSlot = null) {
  const actor = message.from ?? {};
  const name = [actor.first_name, actor.last_name].filter(Boolean).join(" ").trim()
    || (actor.username ? `@${actor.username}` : `Telegram ${actor.id ?? message.chat.id}`);
  const existing = await userByChat(env, message.chat.id);
  const effectiveRole = role ?? existing?.role ?? "client";
  await env.DB.prepare(`
    INSERT INTO users (chat_id, user_id, role, admin_slot, display_name, username, active, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(chat_id) DO UPDATE SET
      user_id = excluded.user_id,
      role = excluded.role,
      admin_slot = COALESCE(excluded.admin_slot, users.admin_slot),
      display_name = excluded.display_name,
      username = excluded.username,
      active = 1,
      last_seen_at = CURRENT_TIMESTAMP
  `).bind(
    message.chat.id,
    actor.id ?? message.chat.id,
    effectiveRole,
    adminSlot ?? existing?.admin_slot ?? null,
    name,
    actor.username ?? null,
  ).run();
  return userByChat(env, message.chat.id);
}

export async function savePhone(env, chatId, phone) {
  await env.DB.prepare(
    "UPDATE users SET phone = ?, last_seen_at = CURRENT_TIMESTAMP WHERE chat_id = ?",
  ).bind(phone, chatId).run();
}

export async function freeDateKeys(env) {
  const result = await env.DB.prepare(`
    SELECT DISTINCT strftime('%Y-%m-%d', s.starts_at, '+3 hours') AS date_key
    FROM slots s
    WHERE s.status = 'free'
      AND s.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+15 minutes')
      AND NOT EXISTS (
        SELECT 1 FROM appointments a WHERE a.slot_id = s.id AND a.status = 'booked'
      )
    ORDER BY s.starts_at
    LIMIT 45
  `).all();
  return (result.results ?? []).map((row) => row.date_key);
}

export async function freeSlotsForDate(env, dateKey) {
  const result = await env.DB.prepare(`
    SELECT s.id, s.starts_at, s.ends_at
    FROM slots s
    WHERE s.status = 'free'
      AND strftime('%Y-%m-%d', s.starts_at, '+3 hours') = ?
      AND s.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+15 minutes')
      AND NOT EXISTS (
        SELECT 1 FROM appointments a WHERE a.slot_id = s.id AND a.status = 'booked'
      )
    ORDER BY s.starts_at
  `).bind(dateKey).all();
  return result.results ?? [];
}

export function slotById(env, slotId) {
  return env.DB.prepare(`
    SELECT s.*,
      CASE WHEN s.status <> 'free'
        OR s.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+15 minutes')
        OR EXISTS (
        SELECT 1 FROM appointments a WHERE a.slot_id = s.id AND a.status = 'booked'
      ) THEN 0 ELSE 1 END AS available
    FROM slots s
    WHERE s.id = ? LIMIT 1
  `).bind(slotId).first();
}

export async function addSlots(env, slots) {
  if (!slots.length) return { added: 0, total: 0 };
  const statements = slots.map((slot) => env.DB.prepare(
    "INSERT OR IGNORE INTO slots (starts_at, ends_at, status) VALUES (?, ?, 'free')",
  ).bind(slot.startsAt, slot.endsAt));
  const results = await env.DB.batch(statements);
  return {
    added: results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0),
    total: slots.length,
  };
}

export async function clearFreeSlotsForDate(env, dateKey) {
  const result = await env.DB.prepare(`
    DELETE FROM slots
    WHERE strftime('%Y-%m-%d', starts_at, '+3 hours') = ?
      AND NOT EXISTS (
        SELECT 1 FROM appointments a WHERE a.slot_id = slots.id AND a.status = 'booked'
      )
  `).bind(dateKey).run();
  return result.meta?.changes ?? 0;
}

export async function createAppointment(env, { slotId, client }) {
  try {
    const result = await env.DB.prepare(`
      INSERT INTO appointments (
        slot_id, client_chat_id, service_id, status, client_name, client_phone, booked_at
      )
      SELECT s.id, ?, 1, 'booked', ?, ?, CURRENT_TIMESTAMP
      FROM slots s
      WHERE s.id = ?
        AND s.status = 'free'
        AND s.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+15 minutes')
        AND EXISTS (SELECT 1 FROM services sv WHERE sv.id = 1 AND sv.active = 1)
        AND NOT EXISTS (
          SELECT 1 FROM appointments a WHERE a.slot_id = s.id AND a.status = 'booked'
        )
    `).bind(
      client.chat_id,
      client.display_name,
      client.phone ?? null,
      slotId,
    ).run();
    if ((result.meta?.changes ?? 0) !== 1) return null;
    return appointmentById(env, Number(result.meta?.last_row_id));
  } catch (error) {
    if (String(error?.message ?? "").includes("UNIQUE constraint failed")) return null;
    throw error;
  }
}

export async function createManualAppointment(env, {
  slotId,
  clientName,
  clientPhone = null,
  bookedByChatId,
}) {
  const manualChatId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
  await env.DB.prepare(`
    INSERT INTO users (
      chat_id, user_id, role, display_name, phone, active, created_at, last_seen_at
    ) VALUES (?, ?, 'client', ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(manualChatId, manualChatId, clientName, clientPhone).run();

  try {
    const result = await env.DB.prepare(`
      INSERT INTO appointments (
        slot_id, client_chat_id, service_id, status, client_name, client_phone,
        booked_at, source, booked_by_chat_id
      )
      SELECT s.id, ?, 1, 'booked', ?, ?, CURRENT_TIMESTAMP, 'manual', ?
      FROM slots s
      WHERE s.id = ?
        AND s.status = 'free'
        AND s.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+15 minutes')
        AND EXISTS (SELECT 1 FROM services sv WHERE sv.id = 1 AND sv.active = 1)
        AND NOT EXISTS (
          SELECT 1 FROM appointments a WHERE a.slot_id = s.id AND a.status = 'booked'
        )
    `).bind(
      manualChatId,
      clientName,
      clientPhone,
      bookedByChatId,
      slotId,
    ).run();
    if ((result.meta?.changes ?? 0) !== 1) {
      await env.DB.prepare("DELETE FROM users WHERE chat_id = ?").bind(manualChatId).run();
      return null;
    }
    return appointmentById(env, Number(result.meta?.last_row_id));
  } catch (error) {
    await env.DB.prepare("DELETE FROM users WHERE chat_id = ?").bind(manualChatId).run();
    if (String(error?.message ?? "").includes("UNIQUE constraint failed")) return null;
    throw error;
  }
}

export function appointmentById(env, appointmentId) {
  return env.DB.prepare(`
    SELECT a.*, s.starts_at, s.ends_at, sv.name AS service_name,
           u.username AS current_username, u.phone AS current_phone
    FROM appointments a
    JOIN slots s ON s.id = a.slot_id
    JOIN services sv ON sv.id = a.service_id
    JOIN users u ON u.chat_id = a.client_chat_id
    WHERE a.id = ? LIMIT 1
  `).bind(appointmentId).first();
}

export async function clientAppointments(env, chatId) {
  const result = await env.DB.prepare(`
    SELECT a.*, s.starts_at, s.ends_at, sv.name AS service_name
    FROM appointments a
    JOIN slots s ON s.id = a.slot_id
    JOIN services sv ON sv.id = a.service_id
    WHERE a.client_chat_id = ? AND a.status = 'booked'
      AND s.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')
    ORDER BY s.starts_at
    LIMIT 12
  `).bind(chatId).all();
  return result.results ?? [];
}

export async function ownerAppointments(env, limit = 30) {
  const result = await env.DB.prepare(`
    SELECT a.*, s.starts_at, s.ends_at, sv.name AS service_name,
           u.username AS current_username, u.phone AS current_phone
    FROM appointments a
    JOIN slots s ON s.id = a.slot_id
    JOIN services sv ON sv.id = a.service_id
    JOIN users u ON u.chat_id = a.client_chat_id
    WHERE a.status = 'booked'
      AND s.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')
    ORDER BY s.starts_at
    LIMIT ?
  `).bind(limit).all();
  return result.results ?? [];
}

export async function cancelAppointment(env, appointmentId, actorRole, actorChatId) {
  const access = actorRole === "owner" ? "1 = 1" : "client_chat_id = ?";
  const statement = env.DB.prepare(`
    UPDATE appointments
    SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?
    WHERE id = ? AND status = 'booked' AND ${access}
  `);
  const result = actorRole === "owner"
    ? await statement.bind(actorRole, appointmentId).run()
    : await statement.bind(actorRole, appointmentId, actorChatId).run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function completeAppointment(env, appointmentId) {
  const result = await env.DB.prepare(
    "UPDATE appointments SET status = 'completed' WHERE id = ? AND status = 'booked'",
  ).bind(appointmentId).run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function rescheduleAppointment(env, appointmentId, newSlotId, clientChatId) {
  try {
    const result = await env.DB.prepare(`
      UPDATE appointments
      SET slot_id = ?, rescheduled_at = CURRENT_TIMESTAMP,
          reminder_24_sent = 0, reminder_2_sent = 0
      WHERE id = ? AND client_chat_id = ? AND status = 'booked'
        AND slot_id <> ?
        AND EXISTS (
          SELECT 1 FROM slots s
          WHERE s.id = ? AND s.status = 'free'
            AND s.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+15 minutes')
            AND NOT EXISTS (
              SELECT 1 FROM appointments other
              WHERE other.slot_id = s.id AND other.status = 'booked'
            )
        )
    `).bind(newSlotId, appointmentId, clientChatId, newSlotId, newSlotId).run();
    if ((result.meta?.changes ?? 0) !== 1) return null;
    return appointmentById(env, appointmentId);
  } catch (error) {
    if (String(error?.message ?? "").includes("UNIQUE constraint failed")) return null;
    throw error;
  }
}

export async function calendarSummary(env, dateKey) {
  const result = await env.DB.prepare(`
    SELECT s.id, s.starts_at, s.ends_at, s.status,
           a.id AS appointment_id, a.client_name, sv.name AS service_name
    FROM slots s
    LEFT JOIN appointments a ON a.slot_id = s.id AND a.status = 'booked'
    LEFT JOIN services sv ON sv.id = a.service_id
    WHERE strftime('%Y-%m-%d', s.starts_at, '+3 hours') = ?
    ORDER BY s.starts_at
  `).bind(dateKey).all();
  return result.results ?? [];
}

export async function setSession(env, chatId, flow, data = {}) {
  await env.DB.prepare(`
    INSERT INTO sessions (chat_id, flow, data_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(chat_id) DO UPDATE SET
      flow = excluded.flow,
      data_json = excluded.data_json,
      updated_at = CURRENT_TIMESTAMP
  `).bind(chatId, flow, JSON.stringify(data)).run();
}

export async function getSession(env, chatId) {
  const row = await env.DB.prepare("SELECT * FROM sessions WHERE chat_id = ? LIMIT 1")
    .bind(chatId).first();
  if (!row) return null;
  try {
    return { flow: row.flow, data: JSON.parse(row.data_json || "{}") };
  } catch {
    return { flow: row.flow, data: {} };
  }
}

export function clearSession(env, chatId) {
  return env.DB.prepare("DELETE FROM sessions WHERE chat_id = ?").bind(chatId).run();
}

export async function dueReminders(env, hours, limit = 30) {
  const flag = hours === 24 ? "reminder_24_sent" : "reminder_2_sent";
  const modifier = `+${hours} hours`;
  const result = await env.DB.prepare(`
    SELECT a.id, a.client_chat_id, a.client_name, a.source,
           s.starts_at, sv.name AS service_name
    FROM appointments a
    JOIN slots s ON s.id = a.slot_id
    JOIN services sv ON sv.id = a.service_id
    WHERE a.status = 'booked' AND a.${flag} = 0
      AND s.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND s.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
    ORDER BY s.starts_at
    LIMIT ?
  `).bind(modifier, limit).all();
  return result.results ?? [];
}

export async function markReminderSent(env, appointmentId, hours) {
  const column = hours === 24 ? "reminder_24_sent" : "reminder_2_sent";
  await env.DB.prepare(`UPDATE appointments SET ${column} = 1 WHERE id = ?`)
    .bind(appointmentId).run();
}

export async function nextReminderAt(env) {
  const result = await env.DB.prepare(`
    SELECT s.starts_at, a.reminder_24_sent, a.reminder_2_sent
    FROM appointments a
    JOIN slots s ON s.id = a.slot_id
    WHERE a.status = 'booked'
      AND s.starts_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND (a.reminder_24_sent = 0 OR a.reminder_2_sent = 0)
    ORDER BY s.starts_at
    LIMIT 100
  `).all();

  let next = Number.POSITIVE_INFINITY;
  for (const row of result.results ?? []) {
    const starts = new Date(row.starts_at).getTime();
    if (!row.reminder_24_sent) next = Math.min(next, starts - 24 * 60 * 60 * 1000);
    if (!row.reminder_2_sent) next = Math.min(next, starts - 2 * 60 * 60 * 1000);
  }
  return Number.isFinite(next) ? next : null;
}
