import { execSync } from "node:child_process";

const TEST_DB = "music_app_test";
const TEST_DATABASE_URL = `postgresql://postgres:postgres@localhost:5433/${TEST_DB}`;

export default async function setup() {
  ensureTestDb();
  applyMigrations();
}

function ensureTestDb(): void {
  try {
    execSync(
      `docker compose exec -T db psql -U postgres -d postgres -c "CREATE DATABASE ${TEST_DB}"`,
      { stdio: "pipe" },
    );
  } catch (err) {
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String((err as { stderr: unknown }).stderr ?? "")
        : err instanceof Error
          ? err.message
          : String(err);
    if (stderr.includes("already exists")) {
      return;
    }
    throw new Error(
      `Failed to create test database "${TEST_DB}". Is docker compose running? Original error: ${stderr}`,
    );
  }
}

function applyMigrations(): void {
  execSync("pnpm prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
