import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// SQLite via the better-sqlite3 adapter (Prisma 7 requires an adapter; SQLite
// has no built-in default in 7.x). DATABASE_URL is something like
// `file:./dev.db` (relative paths are resolved from the project root).
function dbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  return url.replace(/^file:/, "");
}

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? `file:${dbPath()}` });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
