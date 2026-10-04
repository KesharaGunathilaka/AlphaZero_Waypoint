-- 004: demo accounts use @example.com (the addresses created in Clerk for the deployed app).
-- The API links a Clerk sign-in to its wp.app_user row by e-mail, so the two must match.
-- Renames existing rows instead of adding new ones (a driver row owns its vehicle). Safe to re-run.
UPDATE wp.app_user
SET email = replace(email, '@waypoint.demo', '@example.com')
WHERE email LIKE '%@waypoint.demo'
  AND NOT EXISTS (SELECT 1 FROM wp.app_user x WHERE x.email = replace(wp.app_user.email, '@waypoint.demo', '@example.com'));
