PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  chat_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'owner')),
  display_name TEXT NOT NULL,
  username TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_owner ON users(role) WHERE role = 'owner';

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  price_text TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  starts_at TEXT NOT NULL UNIQUE,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'blocked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id INTEGER NOT NULL REFERENCES slots(id),
  client_chat_id INTEGER NOT NULL REFERENCES users(chat_id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show')),
  client_name TEXT NOT NULL,
  client_phone TEXT,
  notes TEXT,
  booked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rescheduled_at TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT CHECK (cancelled_by IN ('client', 'owner')),
  reminder_24_sent INTEGER NOT NULL DEFAULT 0 CHECK (reminder_24_sent IN (0, 1)),
  reminder_2_sent INTEGER NOT NULL DEFAULT 0 CHECK (reminder_2_sent IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_appointment_per_slot
  ON appointments(slot_id) WHERE status = 'booked';

CREATE TABLE IF NOT EXISTS sessions (
  chat_id INTEGER PRIMARY KEY,
  flow TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_slots_starts ON slots(starts_at, status);
CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_chat_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status, slot_id);

INSERT OR IGNORE INTO services (id, name, description, price_text, sort_order) VALUES
  (1, 'Мужская стрижка', 'Подбор формы, стрижка и укладка', 'Стоимость уточните у мастера', 10),
  (2, 'Стрижка + борода', 'Комплексный образ: волосы и оформление бороды', 'Стоимость уточните у мастера', 20),
  (3, 'Оформление бороды', 'Форма, контуры и аккуратная укладка', 'Стоимость уточните у мастера', 30),
  (4, 'Детская стрижка', 'Стрижка для юного гостя', 'Стоимость уточните у мастера', 40),
  (5, 'Другая услуга', 'Детали можно согласовать с мастером', 'По договорённости', 50);
