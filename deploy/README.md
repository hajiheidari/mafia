# Deploy — espadna.com

## `mafia-tool/` — narrator tool (static, offline) → `mafia.espadna.com`

The in-person Mafia narrator tool: player names, random role deal (pass the
phone), night wizard with automatic resolution (doctor, lecter, sniper,
die-hard, detective), talk timer, vote counter, undo, win detection.
Plain HTML/JS, no build step, no server: everything stays in the browser
(localStorage). A service worker makes it work offline after the first visit
(needs HTTPS). Upload the *contents* of `deploy/mafia-tool/` (including
`.htaccess`) to the subdomain's document root. Rule logic lives in
`logic.js` and is tested by `tests/mafia-tool/logic.test.ts`.

## `mafia-app/` — intro page (static)

Plain HTML + self-hosted Vazirmatn fonts. No build step.
Upload the *contents* of `deploy/mafia-app/` (including the hidden `.htaccess`)
to the target folder with DirectAdmin → File Manager (or FTP).

The "start game" buttons point to `MAFIA_APP_URL` near the end of
`index.html` (default `https://mafia.espadna.com`). Change that one line if
the game ends up at a different address.

## The game itself (`mafia.espadna.com`)

The game is a Node.js app (Next.js web + Fastify/Socket.IO server) that
needs PostgreSQL and Redis and a long-running process with WebSockets.
See the main README for requirements.
