ALTER TABLE appointments
ADD COLUMN source TEXT NOT NULL DEFAULT 'telegram'
CHECK (source IN ('telegram', 'manual'));

ALTER TABLE appointments
ADD COLUMN booked_by_chat_id INTEGER;
