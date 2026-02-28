import { useEffect, useMemo, useState } from 'react'
import type { Playlist, Settings, TrackRow } from './types'

type Tab = 'sync' | 'settings'

const defaultSettings: Settings = {
  spotifyClientId: '',
  spotifyClientSecret: '',
  discogsToken: '',
  useMockMode: false
}

export default function App() {
  const [tab, setTab] = useState<Tab>('sync')
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedPlaylist, setSelectedPlaylist] = useState<string>('')
  const [rows, setRows] = useState<TrackRow[]>([])
  const [status, setStatus] = useState('Ready')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((s) => setSettings(s))
  }, [])

  const totalMedian = useMemo(
    () => rows.reduce((sum, r) => sum + (r.medianPrice || 0), 0),
    [rows]
  )

  async function saveSettings() {
    setBusy(true)
    try {
      await window.api.saveSettings(settings)
      setStatus(`Settings saved (${settings.storageMode || 'auto'})`)
    } catch (e: any) {
      setStatus(`Failed to save settings: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function connectSpotify() {
    setBusy(true)
    try {
      setStatus('Opening Spotify OAuth...')
      await window.api.spotifyAuth()
      const p = await window.api.spotifyPlaylists()
      setPlaylists(p)
      setStatus(`Connected. Loaded ${p.length} playlists.`)
    } catch (e: any) {
      setStatus(`Spotify auth failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function importAndMatch() {
    setBusy(true)
    try {
      setStatus('Importing Spotify tracks...')
      const imported = await window.api.spotifyImport(selectedPlaylist || null)
      setStatus(`Imported ${imported.length} tracks. Matching Discogs...`)
      const enriched = await window.api.discogsEnrich(imported)
      setRows(enriched)
      setStatus(`Done. ${enriched.length} rows ready.`)
    } catch (e: any) {
      setStatus(`Import failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  function exportCsv() {
    const header = ['Track', 'Artist', 'Album', 'Matched Release', 'Median Price', 'Marketplace URL']
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [r.track, r.artist, r.album, r.matchedRelease || '', r.medianPrice ?? '', r.listingUrl || '']
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(',')
      )
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spotify-discogs-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <header>
        <h1>Spotify → Discogs Alpha</h1>
        <div className="tabs">
          <button className={tab === 'sync' ? 'active' : ''} onClick={() => setTab('sync')}>Sync</button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
        </div>
      </header>

      {tab === 'settings' ? (
        <section className="card form">
          <label>Spotify Client ID
            <input value={settings.spotifyClientId} onChange={(e) => setSettings({ ...settings, spotifyClientId: e.target.value })} />
          </label>
          <label>Spotify Client Secret
            <input value={settings.spotifyClientSecret} onChange={(e) => setSettings({ ...settings, spotifyClientSecret: e.target.value })} />
          </label>
          <label>Discogs Personal Token
            <input value={settings.discogsToken} onChange={(e) => setSettings({ ...settings, discogsToken: e.target.value })} />
          </label>
          <label className="inline">
            <input type="checkbox" checked={settings.useMockMode} onChange={(e) => setSettings({ ...settings, useMockMode: e.target.checked })} />
            Use mock mode (for UI/data pipeline testing without API creds)
          </label>
          <p className="muted">Storage: {settings.storageMode || 'auto'} (keychain preferred, encrypted local fallback).</p>
          <button disabled={busy} onClick={saveSettings}>Save Settings</button>
        </section>
      ) : (
        <>
          <section className="card actions">
            <button disabled={busy} onClick={connectSpotify}>1) Connect Spotify</button>
            <select value={selectedPlaylist} onChange={(e) => setSelectedPlaylist(e.target.value)} disabled={busy || playlists.length === 0}>
              <option value="">No playlist (Liked Songs only)</option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.tracks})</option>
              ))}
            </select>
            <button disabled={busy} onClick={importAndMatch}>2) Import + Match Discogs</button>
            <button disabled={rows.length === 0} onClick={exportCsv}>Export CSV</button>
          </section>

          <section className="card">
            <p className="muted">{status}</p>
            <p className="muted">Rows: {rows.length} · Sum of medians: ${totalMedian.toFixed(2)}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Track</th>
                    <th>Artist</th>
                    <th>Album</th>
                    <th>Matched Release</th>
                    <th>Median Price</th>
                    <th>Marketplace</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={`${r.track}-${idx}`}>
                      <td>{r.track}</td>
                      <td>{r.artist}</td>
                      <td>{r.album}</td>
                      <td>{r.matchedRelease || '—'}</td>
                      <td>{r.medianPrice ? `$${r.medianPrice.toFixed(2)}` : '—'}</td>
                      <td>
                        {r.listingUrl ? <a href={r.listingUrl} target="_blank">Open</a> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
