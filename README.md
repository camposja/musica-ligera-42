# Música Ligera 42

A music app built on Next.js + PostgreSQL + Prisma. Spotify search and playlist import, YouTube playback.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- PostgreSQL 15 (via Docker Compose)
- Prisma 7

## Dev quickstart

```bash
docker compose up -d            # start Postgres
pnpm install                    # install deps
cp .env.example .env            # then edit .env with your credentials
pnpm prisma migrate dev         # apply schema
pnpm dev                        # http://localhost:3000
```

## Layout

- `src/app/` — Next.js app router
- `src/lib/prisma.ts` — Prisma client singleton
- `prisma/schema.prisma` — data model
- `docker-compose.yml` — Postgres service
