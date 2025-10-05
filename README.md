# Decap CMS GitHub OAuth Provider (Express)

A minimal OAuth provider for Decap CMS (formerly Netlify CMS) using the GitHub backend.

It exposes two endpoints:
- `GET /auth?provider=github&origin=https://your-site.example` – redirects to GitHub
- `GET /callback` – exchanges `code` for an access token and posts it back to Decap

The provider returns a tiny HTML page that posts the token using the message format Decap expects: `authorization:github:ACCESS_TOKEN`.

## Deploy (Render)

1. Create a new Web Service and connect this repo.
2. Environment variables (Dashboard → Environment):
   - `OAUTH_CLIENT_ID` – GitHub OAuth App Client ID
   - `OAUTH_CLIENT_SECRET` – GitHub OAuth App Client Secret
   - `REDIRECT_URL` – `https://YOUR-OAUTH-SERVICE.onrender.com/callback`
   - `ORIGINS` – comma-separated hostnames allowed (no protocol), e.g. `femme-essentials.onrender.com`
   - Optional: `SCOPES=public_repo` (use `repo` if your repo is private)
3. Start command: `npm start`
4. After deploy, note your base URL, e.g. `https://YOUR-OAUTH-SERVICE.onrender.com`.

## GitHub OAuth App setup

- Homepage URL: your site, e.g. `https://femme-essentials.onrender.com/`
- Authorization callback URL: `https://YOUR-OAUTH-SERVICE.onrender.com/callback`

## Decap config (admin/config.yml)

```yaml
backend:
  name: github
  repo: <owner>/<repo>
  branch: main
  base_url: https://YOUR-OAUTH-SERVICE.onrender.com
```

## Local dev

```bash
cp .env.example .env
npm install
npm start
```

Open: `http://localhost:3000/healthz` → `ok`

## Notes

- Node 18+ recommended (package.json sets engines)
- `ORIGINS` must include every hostname you will use to access `/admin`
- If your repo is private, set `SCOPES=repo`

