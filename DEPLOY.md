# Deploying / Redeploying

This app is a static site (HTML shell + `css/` + `js/` + `audio/`), hosted on Cloudflare Pages via direct upload — no build step required.

## Local development

ES modules require an HTTP server — they **do not load over `file://`**:

```bash
python3 -m http.server 8787
# or: npx serve .
```

Open http://localhost:8787/hogwarts-espanol.html

## Redeploy after making changes

1. If you added/removed/renamed files in `audio/`, regenerate the manifest first:
   ```
   node -e "const fs=require('fs');fs.writeFileSync('audio/manifest.json',JSON.stringify(fs.readdirSync('audio').filter(f=>f.toLowerCase().endsWith('.mp3')).sort(),null,2)+'\n')"
   ```
2. Deploy:
   ```
   npx wrangler pages deploy . --project-name=hogwarts-espanol
   ```
   Run both commands from this project folder. The live URL updates within seconds — no other steps needed.

First-time setup (already done once): `npx wrangler login` to authenticate with a free Cloudflare account.
