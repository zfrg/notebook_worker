# Notebook

A cloud-synced notebook app built with React + TypeScript and deployed on Cloudflare Workers.

## Features

- Create, edit, save, and delete notes
- Username/password authentication
- Cloud sync via Cloudflare Workers
- Supports both D1 (SQL) and KV storage backends

## Tech Stack

- **Frontend:** React 18, TypeScript, Tailwind CSS, Vite
- **Backend:** Cloudflare Workers
- **Storage:** Cloudflare D1 or Cloudflare KV (bind either one)

## Getting Started

```bash
npm install
npm run dev
```

## Deployment

### 1. Configure Cloudflare bindings

Edit `wrangler.jsonc` and set up at least one storage binding:

**Option A — D1:**

```bash
npx wrangler d1 create notebook
```

Copy the returned `database_id` and add to `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "notebook",
    "database_id": "<your-database-id>"
  }
]
```

Apply migrations:

```bash
npx wrangler d1 migrations apply notebook
```

**Option B — KV:**

```bash
npx wrangler kv:namespace create notebook
```

Copy the returned `id` and add to `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "KV",
    "id": "<your-namespace-id>"
  }
]
```

### 2. Deploy

```bash
npx wrangler deploy
```

### 3. Set API_BASE (if needed)

If the Worker is deployed to a different domain, update `API_BASE` in `src/App.tsx:10` to point to the Worker URL.

## Project Structure

```
├── src/
│   ├── App.tsx          # Main React component with auth + notes UI
│   ├── index.tsx        # Entry point
│   └── index.css        # Tailwind directives
├── worker/
│   └── index.js         # Cloudflare Worker — REST API with D1 & KV support
├── migrations/
│   ├── 0000_create_notes.sql
│   └── 0001_create_users_sessions.sql
├── wrangler.jsonc       # Cloudflare Worker configuration
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## API Endpoints

All `/api/notes/*` endpoints require `Authorization: Bearer <token>` header.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Log in, returns token |
| POST | `/api/auth/logout` | Invalidate token |
| GET | `/api/notes` | List all notes |
| PUT | `/api/notes/:id` | Create or update a note |
| DELETE | `/api/notes/:id` | Delete a note |

## Development

- `npm run dev` — Vite dev server
- `npm run build` — TypeScript check + production build
- `npm run preview` — Preview production build
