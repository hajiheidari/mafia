# Mafia God (گاد مافیا) — web

| Address | What | Source |
|---|---|---|
| `https://mafia.espadna.com` | the narrator tool (offline PWA; fa, en, ar, ru, ur) | `web/tool/` |
| `https://espadna.com/mafia-app/` (`fa/`, `ar/`, `ru/`, `ur/`) | landing pages + privacy | `tools/landing.py` → `web/landing/mafia-app/` |
| `https://mafia.espadna.ir`, `https://espadna.ir/mafia-app/` | Iranian copies (national internet) | made by hajiheidari/espadna-site `mirror-ir/` |

Same layout as the other Espadna apps (Tiaro, Adadi): the app's web version on
its own subdomain, its landing pages served on espadna.com by a Worker route
from this repo, and only its card / sitemap / mirror lines in espadna-site.

## Build and deploy

```bash
python3 tools/landing.py      # after editing texts in tools/landing.py
node tools/web_build.mjs      # → build/tool, build/landing, build/mafia-web.zip
```

`.github/workflows/web.yml` tests, builds and deploys both Workers on every
push to `main` (secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).
Never run `wrangler deploy` by hand.

Each build writes `files.json` (every file with its sha256 + the redirects
text) at the root of both sites; the mirror on espadna.ir copies from it.

## The tool

### Languages

Persian, English, Arabic, Russian and Urdu. Every visible text is a key in
`web/tool/lang/<code>.js` (Persian is the original, `fa.js`); `i18n.js` picks
the language — `?lang=` in the link, then the saved choice, then Persian in
Iran, then the phone's language, else English — and handles digits, plural
forms (Intl.PluralRules), direction and the 🌐 picker. `logic.js` holds no
text: errors come back as `{ key, vars }`. Ready-made scenarios list their
languages (`langs` in `scenarios.js`): the Iranian ones in Persian, three
world classics elsewhere, plus Russia's sport and city mafia in Russian. To
add a language: copy `en.js`, translate, register it in `LANGS` in `i18n.js`
and in `sw.js`, and add the landing texts in `tools/landing.py`.

Plain HTML/JS, no build step, no server: game state stays in the browser
(localStorage). `web/tool/logic.js` holds the rules (tested by
`tests/mafia-tool/logic.test.ts`); `app.js` is the UI. The service worker
(`sw.js`) makes it work offline after the first visit (HTTPS only).
The same files are packed into the Android/iOS apps (`mobile/`).
