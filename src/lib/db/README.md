## Database (Drizzle + Postgres)

### Setup

1) Copy `env.example` → `.env.local` and fill in `DATABASE_URL`.
2) Generate migrations (optional if you prefer `push`):

```bash
pnpm db:generate
```

3) Apply schema to the database:

```bash
pnpm db:push
```

### Notes

- This project expects `DATABASE_URL` to be set and will fail fast at runtime if missing.
- `db:push` is convenient for early development; for production environments, prefer explicit migrations.


