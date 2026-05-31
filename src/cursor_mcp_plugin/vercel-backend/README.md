# Analyze Design — Vercel backend (Bonzai vision)

Server-side proxy for the plugin's **Analyze Design** action. It holds the
Bonzai API key and forwards a multimodal (text + image) chat request to the
Bonzai gateway, returning the model's JSON content to the plugin.

The plugin talks only to this backend; the Bonzai key never reaches the plugin
bundle.

## Route

`POST /api/bonzai/analyze-design`

Request body (from the plugin):

```jsonc
{
  "imageBase64": "<base64 PNG, no data: prefix>",
  "mimeType": "image/png",
  "systemContext": "<design-review reviewer instructions>",
  "instruction": "<user message + optional screen metadata>",
  "model": "gpt-4o"          // optional; falls back to BONZAI_DEFAULT_MODEL
}
```

Response:

```jsonc
{ "ok": true,  "data": { "content": "<json string>", "model": "gpt-4o", "usage": { } } }
{ "ok": false, "error": "<redacted message>" }
```

The plugin validates `data.content` against the v1 schema in
`src/analysis/designReview.ts` before writing anything to the canvas.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `BONZAI_API_KEY` | yes | Bonzai authentication (kept server-side) |
| `BONZAI_BASE_URL` | yes | e.g. `https://api-v2.bonzai.iodigital.com` |
| `BONZAI_DEFAULT_MODEL` | no | vision-capable default (e.g. `gpt-4o`) |
| `BONZAI_SYSTEM_PROMPT` | no | overrides `bonzai-system-prompt.txt` |
| `PLUGIN_SECRET` | no | when set, requires the `X-Plugin-Token` header |

## Local development

```bash
cd src/cursor_mcp_plugin/vercel-backend
npm install
vercel link
vercel env pull .env.local   # or `vercel dev` pulls dev vars into memory
vercel dev                   # serves on http://localhost:3000
```

Then, in the plugin:

1. Keep `API_BASE = "http://localhost:3000"` in `src/lib/analyzeDesignClient.ts`.
2. `http://localhost:3000` is already in `manifest.json#networkAccess.devAllowedDomains`
   and in `ALLOWED_HOSTS`.
3. Rebuild the plugin (`bun run build:plugin`) and reload it in Figma.

> `vercel env pull` overwrites `.env.local`. Add secrets in Vercel first
> (`vercel env add NAME development`) or export them in your shell so a pull
> does not wipe them. Restart `vercel dev` after editing env.

## Deployment

```bash
vercel --prod
```

1. Set `BONZAI_API_KEY`, `BONZAI_BASE_URL`, and optionally `BONZAI_DEFAULT_MODEL`
   in the Vercel project settings.
2. Point the plugin's `API_BASE` at the deployed origin and confirm that origin
   is in `manifest.json#networkAccess.allowedDomains` **and** in `ALLOWED_HOSTS`
   (the placeholder is `https://cursor-figma-analyze.vercel.app` — replace it
   with your real deployment in both places, in the same change).
3. `devAllowedDomains` is stripped automatically at publish; no cleanup needed.

## Production hardening

This route calls a paid API. For anything beyond local experimentation:

- Set `PLUGIN_SECRET` and send it from the plugin as `X-Plugin-Token`.
- Consider origin checks and rate limiting (see the kit's
  `docs/vercel-proxy.md` "Production hardening" section).
- Error bodies are passed through `redactSecrets()` before they leave the
  server, so upstream key echoes never reach the plugin or logs.
