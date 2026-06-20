# Deploying / Redeploying

This app is a static site (HTML shell + `css/` + `js/` + `audio/`), hosted on Cloudflare Pages via direct upload — no build step required. A companion Cloudflare Worker (`worker/`) handles Google OAuth authentication and cross-device state sync.

## One-time setup

### 1. Google Cloud Console — OAuth 2.0 Client ID + Secret

The app uses Google OAuth for sign-in. You need a Google Cloud project with an OAuth 2.0 Client ID:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create an **OAuth 2.0 Client ID** (Web application type).
3. Add **Authorized JavaScript origins**:
   - `http://localhost:8787` (local dev)
   - `https://hogwarts-espanol.pages.dev` (production)
4. Copy the **Client ID** (ends with `.apps.googleusercontent.com`) and **Client Secret** (starts with `GOCSPX-`).

Update the Client ID in the frontend:
- `js/auth.js` → `GOOGLE_CLIENT_ID` constant (used by GIS)
- `worker/.dev.vars` → `GOOGLE_CLIENT_ID` (local worker dev)
- Production: see step 2 (Worker secrets).

### 2. Cloudflare Worker — secrets

Three secrets are required for the Worker. Use the deploy guard script to validate them:

```bash
# Set JWT signing secret (generate with: openssl rand -base64 32)
npx wrangler secret put JWT_SECRET

# Set Google OAuth Client ID (from step 1)
npx wrangler secret put GOOGLE_CLIENT_ID

# Set Google OAuth Client Secret (from step 1)
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Run from the `worker/` directory.

### 3. Deploy the Worker

```bash
bash scripts/deploy-worker.sh
```

This validates all required secrets are set before deploying. The worker will be available at its `*.workers.dev` subdomain. Update `WORKER_URL` in `js/auth.js` to match.

### 4. Deploy the Pages site

```bash
npx wrangler pages deploy . --project-name=hogwarts-espanol --branch=main
```

## Local development

ES modules require an HTTP server — they **do not load over `file://`**:

```bash
python3 -m http.server 8787
```
Open http://localhost:8787/hogwarts-espanol.html

For local Worker dev:
```bash
cd worker && npx wrangler dev
```
Set client-side `WORKER_URL` in `js/auth.js` to `http://localhost:8788` for local testing.

## Redeploy after making changes

### Worker

```bash
bash scripts/deploy-worker.sh
```

### Pages

1. If you added/removed/renamed files in `audio/`, regenerate the manifest first:
   ```
   node -e "const fs=require('fs');fs.writeFileSync('audio/manifest.json',JSON.stringify(fs.readdirSync('audio').filter(f=>f.toLowerCase().endsWith('.mp3')).sort(),null,2)+'\n')"
   ```
2. Deploy:
   ```
   npx wrangler pages deploy . --project-name=hogwarts-espanol --branch=main
   ```
   Run from this project folder. The live URL updates within seconds.

   **`--branch=main` is required.** The Cloudflare Pages *production* environment is
   mapped to the `main` branch, but the local git branch is `master`. Without
   `--branch=main`, wrangler infers the branch from git (`master`) and publishes a
   *preview* deployment — the production domain is left untouched.

   Verify which branch is production with:
   ```
   npx wrangler pages deployment list --project-name=hogwarts-espanol
   ```
   (look for the row whose Environment is `Production`).

First-time setup (already done once): `npx wrangler login` to authenticate with a free Cloudflare account.
