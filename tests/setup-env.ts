// Path resolved relative to repo root (cwd). Matches tests/global-setup.ts.
import { resolve } from "node:path";
process.env.DATABASE_URL = `file:${resolve(process.cwd(), "prisma", "test.db")}`;
process.env.SESSION_SECRET =
  "0000000000000000000000000000000000000000000000000000000000000000";
process.env.OWNER_USERNAME = "test_owner";
process.env.OWNER_PASSWORD = "test_owner_pw";
// Vitest automatically sets NODE_ENV=test; we don't override it.
