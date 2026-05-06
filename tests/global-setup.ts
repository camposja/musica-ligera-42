import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

// SQLite test database. One file per worker would be safer for parallelism,
// but vitest's default fork pool runs files sequentially per worker and the
// suite shares a single Prisma client across files (see tests/helpers.ts).
// `truncateAll()` in helpers.ts resets the data between tests.
const TEST_DB_PATH = resolve(process.cwd(), "prisma", "test.db");
const TEST_DATABASE_URL = `file:${TEST_DB_PATH}`;

export default async function setup() {
  // Wipe any leftover file so migrate deploy starts from scratch.
  for (const p of [TEST_DB_PATH, `${TEST_DB_PATH}-journal`]) {
    if (existsSync(p)) unlinkSync(p);
  }
  applyMigrations();
  // Vitest forks pick up DATABASE_URL from process.env; helpers.ts imports
  // prisma client which reads this at first use.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

function applyMigrations(): void {
  execSync("pnpm prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
