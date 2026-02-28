import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import os from 'node:os'
import fs from 'node:fs/promises'

let keytar: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  keytar = require('keytar')
} catch {
  keytar = null
}

type Settings = {
  spotifyClientId: string
  spotifyClientSecret: string
  discogsToken: string
  useMockMode: boolean
}

type SpotifyToken = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope: string
}

const SERVICE = 'spotify-discogs-alpha'
const FALLBACK_FILE = () => path.join(app.getPath('userData'), 'secure-settings.json')
const REDIRECT_URI = 'http://127.0.0.1:8888/callback'
const SPOTIFY_SCOPES = [
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative'
].join(' ')

let spotifyToken: SpotifyToken | null = null

function deriveFallbackKey() {
  return crypto
    .createHash('sha256')
    .update(`${os.userInfo().username}:${os.hostname()}:${app.getName()}`)
    .digest()
}

function encryptPayload(data: Settings): string {
  const iv = crypto.randomBytes(12)
  const key = deriveFallbackKey()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex')
  })
}

function decryptPayload(input: string): Settings {
  const parsed = JSON.parse(input)
  const key = deriveFallbackKey()
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(parsed.iv, 'hex')
  )
  decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'hex')),
    decipher.final()
  ])
  return JSON.parse(decrypted.toString('utf8'))
}

async function loadSettings(): Promise<Settings> {
  const defaults: Settings = {
    spotifyClientId: '',
    spotifyClientSecret: '',
    discogsToken: '',
    useMockMode: false
  }

  if (keytar) {
    const raw = await keytar.getPassword(SERVICE, 'settings')
    if (!raw) return defaults
    return { ...defaults, ...JSON.parse(raw) }
  }

  try {
    const raw = await fs.readFile(FALLBACK_FILE(), 'utf8')
    return { ...defaults, ...decryptPayload(raw) }
  } catch {
    return defaults
  }
}

async function saveSettings(settings: Settings) {
  if (keytar) {
    await keytar.setPassword(SERVICE, 'settings', JSON.stringify(settings))
    return
  }

  const enc = encryptPayload(settings)
  await fs.writeFile(FALLBACK_FILE(), enc, 'utf8')
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function b64url(data: Buffer) {
  return data
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function spotifyFetch(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Spotify request failed: ${res.status}`)
  return res.json()
}

function normalize(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function similarity(a: string, b: string) {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const aSet = new Set(na.split(' '))
  const bSet = new Set(nb.split(' '))
  let common = 0
  for (const token of aSet) if (bSet.has(token)) common += 1
  return common / Math.max(aSet.size, bSet.size)
}

async function createSpotifyAuthFlow(settings: Settings): Promise<SpotifyToken> {
  if (!settings.spotifyClientId || !settings.spotifyClientSecret) {
    throw new Error('Spotify credentials are missing in Settings')
  }

  const codeVerifier = b64url(crypto.randomBytes(64))
  const challenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest())
  const state = b64url(crypto.randomBytes(16))

  const authUrl = new URL('https://accounts.spotify.com/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', settings.spotifyClientId)
  authUrl.searchParams.set('scope', SPOTIFY_SCOPES)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('code_challenge', challenge)

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', REDIRECT_URI)
      const reqState = reqUrl.searchParams.get('state')
      const reqCode = reqUrl.searchParams.get('code')
      if (reqState !== state || !reqCode) {
        res.statusCode = 400
        res.end('Authorization failed. You can close this window.')
        server.close()
        reject(new Error('Spotify OAuth failed or state mismatch'))
        return
      }
      res.end('Spotify connected. You can return to the app.')
      server.close()
      resolve(reqCode)
    })

    server.listen(8888, '127.0.0.1', () => {
      void shell.openExternal(authUrl.toString())
    })

    server.on('error', (err) => reject(err))
  })

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.spotifyClientId,
      client_secret: settings.spotifyClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier
    })
  })

  if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`)
  return tokenRes.json() as Promise<SpotifyToken>
}

async function fetchLikedTracks(token: string) {
  const tracks: any[] = []
  let next: string | null = 'https://api.spotify.com/v1/me/tracks?limit=50'
  while (next) {
    const data = await spotifyFetch(next, token)
    for (const item of data.items || []) {
      tracks.push(item.track)
    }
    next = data.next
  }
  return tracks
}

async function fetchPlaylistTracks(token: string, playlistId: string) {
  const tracks: any[] = []
  let next: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`
  while (next) {
    const data = await spotifyFetch(next, token)
    for (const item of data.items || []) {
      if (item.track) tracks.push(item.track)
    }
    next = data.next
  }
  return tracks
}

async function searchDiscogs(discogsToken: string, artist: string, album: string) {
  const url = new URL('https://api.discogs.com/database/search')
  url.searchParams.set('release_title', album)
  url.searchParams.set('artist', artist)
  url.searchParams.set('type', 'release')
  url.searchParams.set('token', discogsToken)

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'spotify-discogs-alpha/0.1.0' }
  })

  if (!res.ok) return null
  const data = await res.json()
  const results = (data.results || []).slice(0, 8)

  let best: any = null
  let bestScore = 0
  for (const r of results) {
    const score = 0.6 * similarity(r.title || '', `${artist} - ${album}`) +
      0.4 * similarity(r.title || '', album)
    if (score > bestScore) {
      best = r
      bestScore = score
    }
  }

  if (!best || bestScore < 0.25) return null

  let median: number | null = null
  let listingUrl: string | null = best.uri || null

  if (best.id) {
    const detailRes = await fetch(`https://api.discogs.com/releases/${best.id}?token=${discogsToken}`, {
      headers: { 'User-Agent': 'spotify-discogs-alpha/0.1.0' }
    })
    if (detailRes.ok) {
      const detail = await detailRes.json()
      median = detail?.community?.price?.median ?? null
      listingUrl = detail?.uri || listingUrl
    }
  }

  return {
    releaseTitle: best.title,
    medianPrice: median,
    listingUrl,
    confidence: bestScore
  }
}

app.whenReady().then(() => {
  ipcMain.handle('settings:get', async () => {
    const settings = await loadSettings()
    return {
      ...settings,
      storageMode: keytar ? 'keychain' : 'encrypted-file'
    }
  })

  ipcMain.handle('settings:save', async (_evt, settings: Settings) => {
    await saveSettings(settings)
    return true
  })

  ipcMain.handle('spotify:auth', async () => {
    const settings = await loadSettings()
    if (settings.useMockMode) {
      spotifyToken = {
        access_token: 'mock-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: SPOTIFY_SCOPES
      }
      return { ok: true, mock: true }
    }
    spotifyToken = await createSpotifyAuthFlow(settings)
    return { ok: true, mock: false }
  })

  ipcMain.handle('spotify:playlists', async () => {
    const settings = await loadSettings()
    if (settings.useMockMode) {
      return [{ id: 'mock-playlist', name: 'Mock Playlist', tracks: 2 }]
    }
    if (!spotifyToken?.access_token) throw new Error('Spotify not authenticated yet')
    const data = await spotifyFetch('https://api.spotify.com/v1/me/playlists?limit=50', spotifyToken.access_token)
    return (data.items || []).map((p: any) => ({ id: p.id, name: p.name, tracks: p.tracks?.total || 0 }))
  })

  ipcMain.handle('spotify:import', async (_evt, playlistId: string | null) => {
    const settings = await loadSettings()

    if (settings.useMockMode) {
      return [
        { track: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine' },
        { track: 'Paranoid Android', artist: 'Radiohead', album: 'OK Computer' }
      ]
    }

    if (!spotifyToken?.access_token) throw new Error('Spotify not authenticated yet')

    const liked = await fetchLikedTracks(spotifyToken.access_token)
    const playlist = playlistId ? await fetchPlaylistTracks(spotifyToken.access_token, playlistId) : []

    const all = [...liked, ...playlist]
    const unique = new Map<string, any>()

    for (const t of all) {
      if (!t?.name || !t?.album?.name || !Array.isArray(t?.artists)) continue
      const row = {
        track: t.name,
        artist: t.artists.map((a: any) => a.name).join(', '),
        album: t.album.name
      }
      const key = `${normalize(row.track)}|${normalize(row.artist)}|${normalize(row.album)}`
      if (!unique.has(key)) unique.set(key, row)
    }

    return Array.from(unique.values())
  })

  ipcMain.handle('discogs:enrich', async (_evt, tracks: Array<{ track: string; artist: string; album: string }>) => {
    const settings = await loadSettings()
    if (settings.useMockMode) {
      return tracks.map((t, i) => ({
        ...t,
        matchedRelease: `${t.artist} - ${t.album}`,
        medianPrice: i % 2 === 0 ? 27.5 : null,
        listingUrl: 'https://www.discogs.com/'
      }))
    }

    if (!settings.discogsToken) throw new Error('Discogs token missing in Settings')

    const out = []
    for (const t of tracks) {
      const match = await searchDiscogs(settings.discogsToken, t.artist, t.album)
      out.push({
        ...t,
        matchedRelease: match?.releaseTitle || null,
        medianPrice: match?.medianPrice ?? null,
        listingUrl: match?.listingUrl || null
      })
    }
    return out
  })

  createMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
