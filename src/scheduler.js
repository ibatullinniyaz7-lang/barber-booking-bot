import { deliverDueReminders } from "./bot.js";
import { nextReminderAt } from "./db.js";

const MINIMUM_DELAY_MS = 5_000;

export class ReminderScheduler {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async scheduleNext() {
    const timestamp = await nextReminderAt(this.env);
    if (timestamp === null) {
      await this.state.storage.deleteAlarm();
      return null;
    }
    const alarmAt = Math.max(Date.now() + MINIMUM_DELAY_MS, timestamp);
    await this.state.storage.setAlarm(alarmAt);
    return alarmAt;
  }

  async fetch() {
    const alarmAt = await this.scheduleNext();
    return Response.json({ ok: true, alarm_at: alarmAt });
  }

  async alarm() {
    try {
      await deliverDueReminders(this.env);
    } finally {
      await this.scheduleNext();
    }
  }
}
