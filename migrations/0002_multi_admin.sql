ALTER TABLE users ADD COLUMN admin_slot TEXT CHECK (admin_slot IN ('primary', 'backup'));

UPDATE users
SET admin_slot = 'primary'
WHERE role = 'owner' AND admin_slot IS NULL;

DROP INDEX IF EXISTS idx_one_owner;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_admin_per_slot
  ON users(admin_slot) WHERE admin_slot IS NOT NULL;

