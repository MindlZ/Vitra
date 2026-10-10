export interface Release {
  version: string
  items: string[]
}

// newest first. shown once after an update to a version listed here
export const RELEASES: Release[] = [
  {
    version: '0.3.1',
    items: [
      'Finds games in your Games folders, and any folder you add',
      'Genre and co-op tags from Steam, automatically',
      'Better names for games found by folder',
      'A wave behind Home, big picture and the screen saver',
      'Ambient sound',
      'Four new dark wallpapers: Vigil, Hex, Gate and Aurora',
      'Follows Wallpaper Engine as it changes, video wallpapers too',
      'New logo and startup sound',
      'Background apps like Wallpaper Engine no longer count as playtime'
    ]
  },
  {
    version: '0.3.0',
    items: [
      'Synced lyrics, on Home, big picture and the screen saver',
      'Floating visualiser and lyrics, over your games',
      'Your desktop wallpaper as the background, Wallpaper Engine too',
      'Pick your own accent colour',
      'Opens on the screen you left it on',
      'The installer knows when it\'s an update'
    ]
  },
  {
    version: '0.2.1',
    items: [
      'Lighter on your PC, and quieter in the background',
      'Visualiser peaks and glow',
      'Effects settings: blur, particles, peaks, glow',
      'Performance overlay and report'
    ]
  },
  {
    version: '0.2.0',
    items: [
      'Battle.net, EA app, Ubisoft Connect and Riot games',
      'One card per game across stores',
      'Stats, with every session logged',
      'Steam achievements',
      'Xbox friends, and joining Steam friends in game',
      'Programs that start with a game',
      'Backup and restore',
      'A new big picture: drawn transition, Library with a store row, one Menu',
      'Background particles',
      'Start in tray'
    ]
  }
]

const SEEN_KEY = 'vitra.seenVersion'

export function unseenRelease(version: string): Release | null {
  let seen: string | null = null
  try {
    seen = localStorage.getItem(SEEN_KEY)
  } catch {
    // storage can be blocked; then it just shows each time
  }
  if (seen === version) return null
  return RELEASES.find((release) => release.version === version) ?? null
}

export function markSeen(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version)
  } catch {
    // ignore
  }
}
