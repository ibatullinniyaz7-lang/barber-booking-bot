UPDATE appointments SET service_id = 1 WHERE service_id <> 1;

UPDATE services
SET name = 'Приём у барбера', description = NULL, price_text = NULL, active = 1
WHERE id = 1;

UPDATE services SET active = 0 WHERE id <> 1;

