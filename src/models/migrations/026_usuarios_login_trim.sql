-- Logins más largos (emails) y limpieza de espacios al final que impedían el login.
ALTER TABLE usuarios ALTER COLUMN login TYPE VARCHAR(120);

UPDATE usuarios
SET login = lower(trim(both from login))
WHERE login IS DISTINCT FROM lower(trim(both from login));
