export type Settings = {
  spotifyClientId: string
  spotifyClientSecret: string
  discogsToken: string
  useMockMode: boolean
  storageMode?: 'keychain' | 'encrypted-file'
}

export type Playlist = {
  id: string
  name: string
  tracks: number
}

export type TrackRow = {
  track: string
  artist: string
  album: string
  matchedRelease?: string | null
  medianPrice?: number | null
  listingUrl?: string | null
}
