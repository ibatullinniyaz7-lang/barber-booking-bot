import { handleTelegramUpdate } from "./bot.js";
import { claimUpdate, releaseUpdate } from "./db.js";

export { ReminderScheduler } from "./scheduler.js";

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function sameSecret(actual, expected) {
  return Boolean(actual && expected && actual === expected);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "barber-niyaz-bot", timezone: "Europe/Moscow" });
    }

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return json({ ok: false, error: "not_found" }, 404);
    }

    if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), env.WEBHOOK_SECRET)) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }

    if (!(await claimUpdate(env, update.update_id))) return json({ ok: true, duplicate: true });
    try {
      await handleTelegramUpdate(update, env, ctx);
      return json({ ok: true });
    } catch (error) {
      console.error("Update failed", {
        updateId: update.update_id,
        name: error?.name,
        message: error?.message,
      });
      await releaseUpdate(env, update.update_id);
      return json({ ok: false, error: "temporary_failure" }, 500);
    }
  },
};
