// no-inline: prod builds inline < 4KB as data: URLs, which the CSP blocks for media.
// ui-click (2.5KB) worked in dev and was silent packaged
const files = import.meta.glob('../assets/sounds/*.{mp3,ogg,wav}', {
  eager: true,
  query: '?url&no-inline',
  import: 'default'
}) as Record<string, string>

export type SoundName =
  | 'card-hover'
  | 'card-leave'
  | 'ui-click'
  | 'startup'
  | 'big-picture-enter'
  | 'big-picture-exit'
  | 'store-scroll'

// long tails: restart rather than stack copies
const RESTART: ReadonlySet<SoundName> = new Set([
  'card-hover',
  'card-leave',
  'big-picture-enter',
  'big-picture-exit',
  'store-scroll'
])

const urls = new Map<string, string>(
  Object.entries(files).map(([path, url]) => [path.replace(/^.*\//, '').replace(/\.\w+$/, ''), url])
)
const loaded = new Map<string, HTMLAudioElement>()
const lastPlayed = new Map<string, number>()

const MIN_GAP_MS = 45

function audioFor(name: string, url: string): HTMLAudioElement {
  let audio = loaded.get(name)
  if (!audio) {
    audio = new Audio(url)
    audio.preload = 'auto'
    loaded.set(name, audio)
  }
  return audio
}

// Web Audio, not <audio>: Chromium holds back media in a never-visible page and the
// window starts hidden, so <audio> sometimes stayed silent. base64 decoded by hand
// because fetch(data:) is blocked by connect-src
const inlineStartup = Object.values(
  import.meta.glob('../assets/sounds/startup.{mp3,ogg,wav}', {
    eager: true,
    query: '?inline',
    import: 'default'
  }) as Record<string, string>
)[0]

let startup: Promise<{ context: AudioContext; buffer: AudioBuffer } | null> | undefined

export function primeStartup(): Promise<boolean> {
  startup ??= (async () => {
    if (!inlineStartup) return null
    try {
      const context = new AudioContext()
      const base64 = inlineStartup.slice(inlineStartup.indexOf(',') + 1)
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const buffer = await context.decodeAudioData(bytes.buffer)
      return { context, buffer }
    } catch (err) {
      console.warn('[sound] startup sound could not be decoded:', (err as Error).message)
      return null
    }
  })()
  return startup.then(Boolean)
}

// resolves once playing, so the splash starts on the same beat
export async function playStartup(volume: number): Promise<void> {
  await primeStartup()
  const ready = await startup
  if (ready) {
    const { context, buffer } = ready
    if (context.state !== 'running') await context.resume().catch(() => {})
    if (context.state === 'running') {
      const gain = context.createGain()
      gain.gain.value = volume
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(gain).connect(context.destination)
      source.addEventListener('ended', () => void context.close())
      source.start()
      return
    }
  }
  const url = urls.get('startup')
  if (!url) return
  const audio = audioFor('startup', url)
  audio.volume = volume
  await audio.play().catch(() => {})
}

// only RESTART sounds keep a single element to stop
export function stopSound(name: SoundName): void {
  loaded.get(name)?.pause()
}

export function playSound(name: SoundName, volume = 0.35): void {
  const url = urls.get(name)
  if (!url) return

  const now = performance.now()
  if (now - (lastPlayed.get(name) ?? -Infinity) < MIN_GAP_MS) return
  lastPlayed.set(name, now)

  const audio = audioFor(name, url)
  if (RESTART.has(name)) {
    audio.volume = volume
    audio.currentTime = 0
    void audio.play().catch(() => {})
    return
  }
  const clip = audio.cloneNode() as HTMLAudioElement
  clip.volume = volume
  void clip.play().catch(() => {})
}
