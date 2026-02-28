/// <reference types="vite/client" />

interface Window {
  api: {
    getSettings: () => Promise<any>
    saveSettings: (settings: any) => Promise<boolean>
    spotifyAuth: () => Promise<any>
    spotifyPlaylists: () => Promise<any[]>
    spotifyImport: (playlistId: string | null) => Promise<any[]>
    discogsEnrich: (rows: any[]) => Promise<any[]>
  }
}
