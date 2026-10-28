-- Up Migration
-- Optional display name for greetings and the profile page. Existing users fall back to the
-- part of their email before the @ in the UI.
ALTER TABLE users ADD COLUMN name text;

-- Down Migration
ALTER TABLE users DROP COLUMN name;
