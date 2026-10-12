# Mafia God (گاد مافیا) — Android (Cafe Bazaar) and iOS

The apps are the web tool (`web/tool/`) inside a Capacitor shell: same files,
packed into the app, works fully offline. Bundle id / package:
`com.espadna.mafia`. Home-screen name: «گاد مافیا»; App Store name: "Mafia God: Party Narrator".

```bash
cd mobile
npm ci
npm run sync          # build web/tool → www/ → android + ios projects
```

Version name: `version` in `mobile/package.json` (bump it for a new release).
Build numbers come from the GitHub run number.

## Android → Cafe Bazaar (`.github/workflows/android.yml`)

Runs on every push that touches `mobile/` or `web/tool/`; the APK is under the
run's **Artifacts → mafia-bazaar-apk**.

Repository secrets for a store-ready (signed) APK:

| Secret | Value |
|---|---|
| `BAZAAR_KEYSTORE_BASE64` | the `.jks` file in base64 (`base64 -w0 bazaar-upload.jks`) |
| `BAZAAR_KEYSTORE_PASSWORD` | keystore password |
| `BAZAAR_KEY_ALIAS` | key alias (e.g. `bazaar-upload`) |
| `BAZAAR_KEY_PASSWORD` | key password |

The Pantomime Bazaar key can be reused. Without the secrets the APK is
debug-signed: install it on a phone to test, never upload it. Bazaar keeps
the first key forever: every update must be signed with the same one.

## iOS → TestFlight (`.github/workflows/ios.yml`)

Start it from Actions → "iOS (TestFlight)" → Run workflow (or change
`mobile/ios/BUILD` and push). Same method as Pantomime: a temporary
certificate and profile are made from the App Store Connect API key for each
run and revoked afterwards.

Secrets (same values as hajiheidari/pantomime): `ASC_ISSUER_ID`, `ASC_KEY_ID`,
`ASC_PRIVATE_KEY`. Team `RGR5G6VN69`.

Once, in App Store Connect: My Apps → + → New App, bundle id
`com.espadna.mafia` (if it is not in the list yet, run the workflow once: it
registers the bundle id, then the upload step asks you to create the app).
