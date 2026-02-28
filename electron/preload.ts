import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  spotifyAuth: () => ipcRenderer.invoke('spotify:auth'),
  spotifyPlaylists: () => ipcRenderer.invoke('spotify:playlists'),
  spotifyImport: (playlistId: string | null) => ipcRenderer.invoke('spotify:import', playlistId),
  discogsEnrich: (rows: any[]) => ipcRenderer.invoke('discogs:enrich', rows)
})
