# Deploying / Redeploying

This app is a static site (HTML shell + `css/` + `js/` + `audio/`), hosted on Cloudflare Pages via direct upload — no build step required.

## Local development

ES modules require an HTTP server — they **do not load over `file://`**:

```bash
python3 -m http.server 8787
```
Open http://localhost:8787/hogwarts-espanol.html

## Redeploy after making changes

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
