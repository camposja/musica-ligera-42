import { defineConfig, env } from "prisma/config";
import { existsSync } from "node:fs";

// Local dev reads DATABASE_URL from `.env`; production (Docker / Fly) gets it
// from the container env, where there's no `.env` file. Skip the load when
// the file's absent so build-time `prisma generate` doesn't crash inside the
// Docker image.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
