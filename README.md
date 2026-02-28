# Spotify Discogs Alpha (Electron + React + TypeScript)

MVP desktop app for macOS that:
- Connects to Spotify via OAuth
- Imports **Liked Songs** + one selected playlist
- Matches releases on Discogs (basic fuzzy matching by artist+album)
- Shows median price + marketplace URL when available
- Exports a CSV

## Requirements
- macOS
- Node.js 20+
- npm

## Setup
```bash
cd /Users/sabo/projects/spotify-discogs-alpha
npm install
```

## Run locally (dev)
```bash
npm run dev
```

## Build app
```bash
npm run dist
```

Build artifacts:
- `dist/` (renderer assets)
- `dist-electron/` (compiled Electron main/preload)
- `dist/*.dmg` (alpha installer)

## Settings / secrets
In **Settings** tab, configure:
- Spotify Client ID
- Spotify Client Secret
- Discogs Personal Token
- Optional: Mock mode

Secret storage behavior:
1. **Preferred:** macOS Keychain via `keytar`
2. **Fallback:** encrypted local file in Electron userData (`secure-settings.json`)

> TODO(security): fallback encryption key is host/user derived for convenience, not HSM-backed. Keep this as alpha-only fallback and prefer Keychain in production.

## Spotify auth notes
- Redirect URI used by the app: `http://127.0.0.1:8888/callback`
- Add this exact URI in your Spotify app settings.

## Mock mode
If API credentials are unavailable, enable **Use mock mode** in Settings.
This keeps UI + data pipeline testable without external auth/tokens.

## Known limitations (alpha)
- Discogs matching is intentionally basic; false positives/negatives expected.
- Discogs enrichment is serial and may be slow on large libraries.
- Spotify token refresh is not implemented yet (re-auth when token expires).
- CSV export is renderer-initiated download.
- Unsigned dmg (Gatekeeper warnings expected).
