Backend scaffold for Falisha Recruitment Portal

Setup (local):

1. Create a Supabase project and set env variables in `.env` from `.env.example`.
2. From `backend/` run:

```bash
npm install
npm run dev
```

Migrations:
- SQL migration files are in `backend/migrations/`.
- Use Supabase SQL editor or your preferred migration runner to execute them in order.

Security:
- Keep `SUPABASE_SERVICE_ROLE_KEY` secret and only use it in server-side workers.
