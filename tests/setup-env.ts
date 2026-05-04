process.env.DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5433/music_app_test";
process.env.SESSION_SECRET =
  "0000000000000000000000000000000000000000000000000000000000000000";
process.env.OWNER_USERNAME = "test_owner";
process.env.OWNER_PASSWORD = "test_owner_pw";
// Vitest automatically sets NODE_ENV=test; we don't override it.
