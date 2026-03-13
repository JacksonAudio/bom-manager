# Jackson Audio — BOM Manager

Full-stack React app for managing Bills of Materials across products.  
**Stack:** Vite + React · Supabase (Postgres + Auth + Realtime) · Vercel

---

## Deploy in ~20 minutes

### Step 1 — Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **New Project** — name it `jackson-audio-bom`
3. Choose a region close to Texas (e.g. US East)
4. Wait ~2 min for the project to spin up

### Step 2 — Run the database schema

1. In your Supabase dashboard, go to **SQL Editor → New query**
2. Open `supabase/schema.sql` from this repo
3. Paste the entire contents and click **Run**
4. You should see "Success. No rows returned"

### Step 3 — Enable Realtime

1. In Supabase dashboard, go to **Database → Replication**
2. Under **Tables**, enable replication for: `products`, `parts`, `api_keys`

### Step 4 — Get your Supabase credentials

1. Go to **Project Settings → API**
2. Copy your **Project URL** (looks like `https://abcdefgh.supabase.co`)
3. Copy your **anon public** key (long JWT string)

### Step 5 — Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) and click **New Project**
3. Import your GitHub repo
4. Under **Environment Variables**, add:
   ```
   VITE_SUPABASE_URL     = https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY = your-anon-key-here
   ```
5. Click **Deploy**

Vercel will build and deploy automatically. You'll get a URL like `jackson-audio-bom.vercel.app`.

### Step 6 — Add your custom domain (optional)

1. In Vercel, go to your project → **Settings → Domains**
2. Add `bom.jacksonaudio.com`
3. In your DNS provider (wherever jacksonaudio.com is registered), add a CNAME record:
   ```
   Name:  bom
   Value: cname.vercel-dns.com
   ```

### Step 7 — Invite your team

1. Go to your deployed app
2. Each team member clicks **Sign up** with their `@jacksonaudio.com` email
3. They get a confirmation email, click it, then sign in
4. Everyone shares the same workspace — changes appear live for all users

---

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your Supabase credentials
cp .env.example .env
# Edit .env with your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. Start dev server
npm run dev
# Open http://localhost:5173
```

---

## Project structure

```
jackson-bom/
├── supabase/
│   └── schema.sql          ← Run this once in Supabase SQL Editor
├── src/
│   ├── main.jsx             ← React entry point
│   ├── App.jsx              ← Main app (auth gate + BOM UI)
│   ├── components/
│   │   └── AuthScreen.jsx   ← Login / signup form
│   └── lib/
│       ├── supabase.js      ← Supabase client singleton
│       └── db.js            ← All database helpers
├── .env.example             ← Copy to .env, fill in credentials
├── vercel.json              ← SPA routing rewrite
├── vite.config.js
└── package.json
```

---

## Architecture notes

- **Auth:** Supabase email + password. All users share one workspace (Row Level Security grants full access to authenticated users).
- **Realtime:** Supabase Postgres Changes — every INSERT/UPDATE/DELETE on `products` and `parts` is pushed to all connected browsers via WebSocket. No polling.
- **Pricing API keys:** Stored in the `api_keys` table (one shared set for the team). Not end-to-end encrypted — suitable for internal tooling. If stronger security is needed, use [Supabase Vault](https://supabase.com/docs/guides/database/vault).
- **Pricing cache:** Fetched prices are stored in the `parts.pricing` JSONB column so the team doesn't re-fetch every page load. Re-fetch anytime via the Pricing tab.

---

## Cost

| Tier | Cost | When |
|------|------|------|
| Supabase Free | $0 | Up to 50K MAU, 500MB DB — enough for years |
| Supabase Pro | $25/mo | If you need daily backups or >500MB |
| Vercel Free | $0 | Unlimited for this scale |

**Total: $0/month** to start.
