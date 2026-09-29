/*
 * UI sounds. Drop a file into src/renderer/src/assets/sounds/ named after the
 * sound (card-hover.mp3, card-leave.wav, …) and it's picked up at build time;
 * until then playSound() is silently a no-op. Bundled through Vite, so the
 * URLs are same-origin and the CSP needs nothing extra.
 */
// no-inline: Vite turns assets under 4 KB into data: URLs in production, and
// the CSP (default-src 'self', no media-src) blocks data: audio. ui-click is
// 2.5 KB, so it played in dev (served as a file) and was silent when packaged.
const files = import.meta.glob('../assets/sounds/*.{mp3,ogg,wav}', {
  eager: true,
  query: '?url&no-inline',
  import: 'default'
}) as Record<string, string>

export type SoundName = 'card-hover' | 'card-leave' | 'ui-click' | 'startup'

/**
 * Sounds with a long tail restart instead of layering: card-hover is ~1.4 s,
 * so sweeping a row would otherwise stack a dozen copies into a smear.
 */
const RESTART: ReadonlySet<SoundName> = new Set(['card-hover', 'card-leave'])

const urls = new Map<string, string>(
  Object.entries(files).map(([path, url]) => [path.replace(/^.*\//, '').replace(/\.\w+$/, ''), url])
)
const loaded = new Map<string, HTMLAudioElement>()
const lastPlayed = new Map<string, number>()

/** Sweeping the mouse across a row shouldn't machine-gun the same clip. */
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

/*
 * The startup sound goes through Web Audio rather than an <audio> element.
 * Chromium holds back media elements in a page that has never been visible,
 * and Electron's window starts hidden until its first frame is ready, so an
 * <audio> started during that window sometimes never sounded at all. It's
 * bundled inline (a data URL in the JS) and decoded up front, so there's no
 * file to fetch and playback begins the instant it's asked for. Decoded by
 * hand from base64 rather than fetch(data:), which the CSP's connect-src
 * would block.
 */
const inlineStartup = Object.values(
  import.meta.glob('../assets/sounds/startup.{mp3,ogg,wav}', {
    eager: true,
    query: '?inline',
    import: 'default'
  }) as Record<string, string>
)[0]

let startup: Promise<{ context: AudioContext; buffer: AudioBuffer } | null> | undefined

/** Decode the startup sound now; safe to call repeatedly. Resolves false if it can't. */
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

/**
 * Play the startup sound; resolves once it's playing (or has failed), so the
 * splash can start on the same beat. Falls back to an <audio> element if Web
 * Audio isn't available or won't run.
 */
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
      // Played once per launch; free the audio device afterwards.
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
  // Short clicks get a clone per play, so quick presses don't cut each other off.
  const clip = audio.cloneNode() as HTMLAudioElement
  clip.volume = volume
  void clip.play().catch(() => {})
}
