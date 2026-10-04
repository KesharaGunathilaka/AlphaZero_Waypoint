# Waypoint web app

Next.js 16 (App Router), React 19, Tailwind 4, pnpm. Four role apps: `/dispatcher`, `/loader`,
`/driver`, `/store-manager`; `/` sends each user to their own.

```bash
cp .env.example .env.local        # local sign-in against the API on :8000 (Docker or uv)
pnpm install
pnpm dev                          # http://localhost:3000
pnpm lint && npx tsc --noEmit
```

Sign-in is chosen at build time by `NEXT_PUBLIC_AUTH_MODE`: `local` (Docker delivery, demo accounts) or
`clerk` (deployed). Deployed settings: [`.env.production.example`](.env.production.example) and the
[deploy guide](../docs/deploy.md).
