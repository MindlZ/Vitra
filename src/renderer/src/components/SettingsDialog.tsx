import { useEffect, useState, type ReactNode } from 'react'
import {
  Download,
  Eye,
  EyeOff,
  FolderSearch,
  Image as ImageIcon,
  Info,
  KeyRound,
  Library,
  Loader2,
  MonitorPlay,
  Palette as PaletteIcon,
  RefreshCw,
  Scale,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Tv,
  Upload,
  X
} from 'lucide-react'
import CoffeeIcon from './CoffeeIcon'
import type { ProgramsView, ScanResult, Settings } from '@shared/types'
import developerAvatar from '../assets/mindlz.jpg'
import { artUrl, forgetMissingArt } from '../lib/art'
import { activeWallpaper, PRESETS } from '../lib/wallpapers'
import { describeUpdate, useUpdate } from '../lib/update'
import { RELEASES } from '../lib/changelog'
import { MIN_DIM } from './Backdrop'
import Dropdown from './Dropdown'
import { KOFI_URL } from './Sidebar'

const LICENCE_URL = 'https://www.gnu.org/licenses/gpl-3.0.html'

const SCREEN_SAVER_OPTIONS = [
  { value: '0', label: 'Never' },
  { value: '1', label: '1 minute' },
  { value: '2', label: '2 minutes' },
  { value: '5', label: '5 minutes' },
  { value: '10', label: '10 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' }
]

const PROGRAMS_OPTIONS: Array<{ value: ProgramsView; label: string }> = [
  { value: 'library', label: 'In library' },
  { value: 'tab', label: 'Own tab' },
  { value: 'hidden', label: 'Hidden' }
]

type SectionId = 'general' | 'library' | 'appearance' | 'connections' | 'about'

const SECTIONS: Array<{ id: SectionId; label: string; icon: typeof Info; blurb: string }> = [
  {
    id: 'general',
    label: 'General',
    icon: SlidersHorizontal,
    blurb: 'How Vitra behaves when it opens and while you play.'
  },
  {
    id: 'library',
    label: 'Library',
    icon: Library,
    blurb: 'Scanning your stores, and where programs go.'
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: PaletteIcon,
    blurb: 'Your wallpaper, how much of it shows, and the colours it lends the app.'
  },
  {
    id: 'connections',
    label: 'Connections',
    icon: KeyRound,
    blurb: 'Discord, and optional keys for friends and extra cover art.'
  },
  {
    id: 'about',
    label: 'About',
    icon: Info,
    blurb: 'Version, updates and licence.'
  }
]

// module-level: reopening returns to the last section, per session
let lastSection: SectionId = 'general'

interface Props {
  settings: Settings
  lastScan: ScanResult | null
  scanning: boolean
  onClose: () => void
  onChange: (patch: Partial<Settings>) => void
  onPickSteamPath: () => void
  onPickBackground: () => void
  onClearBackground: () => void
  onOpenBigPicture: () => void
  onPreviewScreenSaver: () => void
  onScan: () => void
  onOpenWhatsNew: () => void
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      {title && <h4 className="mb-2 px-1 text-[12px] font-medium text-dim">{title}</h4>}
      <div className="glass-soft rounded-[12px] px-4">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="hairline-b flex items-center gap-5 py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink">{label}</div>
        {hint && <div className="mt-1 text-[11.5px] leading-relaxed text-muted">{hint}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

function Switch({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-[20px] w-[34px] shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? 'border-accent/60 bg-accent/25 shadow-[0_0_14px_-2px_rgb(var(--accent-rgb)/0.6)]'
          : 'border-white/10 bg-white/5'
      }`}
    >
      <span
        className={`h-[13px] w-[13px] rounded-full transition-transform duration-200 ${
          checked ? 'translate-x-[18px] bg-accent' : 'translate-x-[3px] bg-muted'
        }`}
      />
    </button>
  )
}

function WallpaperTile({
  label,
  selected,
  onClick,
  children
}: {
  label: string
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button role="radio" aria-checked={selected} onClick={onClick} className="group flex flex-col gap-1.5 text-left">
      <span
        className={`block aspect-[16/10] w-full overflow-hidden rounded-[9px] transition-shadow ${
          selected
            ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel'
            : 'ring-1 ring-white/10 group-hover:ring-white/25'
        }`}
      >
        {children}
      </span>
      <span className={`text-[11.5px] ${selected ? 'text-ink' : 'text-muted group-hover:text-dim'}`}>
        {label}
      </span>
    </button>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <Row label={label} hint={hint}>
      <Switch label={label} checked={checked} onChange={onChange} />
    </Row>
  )
}

const quietButton =
  'glass-btn flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[12px] text-dim transition-colors hover:text-ink'

function BackupRow({
  label,
  action,
  icon,
  done,
  run
}: {
  label: string
  action: string
  icon: ReactNode
  done: string
  run: () => Promise<{ ok: boolean; error?: string }> | undefined
}) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>()

  return (
    <Row label={label} hint={status}>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setStatus(undefined)
          void Promise.resolve(run())
            .then((result) => {
              // no error = cancelled
              if (result?.ok) setStatus(done)
              else if (result?.error) setStatus(result.error)
            })
            .catch((err: Error) => setStatus(err.message))
            .finally(() => setBusy(false))
        }}
        className={quietButton}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
        {action}
      </button>
    </Row>
  )
}

// write-only: main never sends a key back. commits on blur so a half-typed key
// is never saved and used
function KeyField({
  label,
  hint,
  saved,
  onCommit
}: {
  label: string
  hint: string
  saved: boolean
  onCommit: (value: string | undefined) => void
}) {
  const [draft, setDraft] = useState('')
  const [revealed, setRevealed] = useState(false)

  const commit = (): void => {
    const next = draft.trim()
    // empty = leave it; Remove deletes
    if (!next) return
    onCommit(next)
    setDraft('')
    setRevealed(false)
  }

  return (
    <div className="hairline-b py-4 last:border-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[13px] text-ink">{label}</div>
        <span
          className={`flex items-center gap-1.5 text-[11px] ${saved ? 'text-dim' : 'text-muted'}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${saved ? 'bg-accent' : 'bg-white/20'}`}
            aria-hidden
          />
          {saved ? 'Saved' : 'Not set'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type={revealed ? 'text' : 'password'}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          placeholder={saved ? 'Saved (encrypted). Type to replace' : 'Paste a key'}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          className="glass-btn h-9 min-w-0 flex-1 rounded-[10px] px-3 font-mono text-[12px] text-ink placeholder:font-sans placeholder:text-muted"
        />
        <button
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          disabled={!draft}
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          className="glass-btn flex h-9 w-9 items-center justify-center rounded-[10px] text-muted hover:text-ink"
        >
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        {saved && (
          <button
            type="button"
            onClick={() => onCommit(undefined)}
            aria-label={`Remove ${label}`}
            title={`Remove ${label}`}
            className="glass-btn flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] text-muted hover:text-ink"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        )}
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{hint}</p>
    </div>
  )
}

export default function SettingsDialog({
  settings,
  lastScan,
  scanning,
  onClose,
  onChange,
  onPickSteamPath,
  onPickBackground,
  onClearBackground,
  onOpenBigPicture,
  onPreviewScreenSaver,
  onScan,
  onOpenWhatsNew
}: Props) {
  const [section, setSection] = useState<SectionId>(lastSection)
  const [packaged, setPackaged] = useState(true)
  const [discordReady, setDiscordReady] = useState(true)
  const [version, setVersion] = useState<string | null>(null)
  const update = useUpdate()
  useEffect(() => {
    void window.launcher.getAppInfo?.().then((info) => {
      setPackaged(info.packaged)
      setDiscordReady(info.discordConfigured !== false)
      setVersion(info.version)
    })
  }, [])
  const current = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0]
  const palette = activeWallpaper(settings).palette

  const open = (id: SectionId): void => {
    lastSection = id
    setSection(id)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const general = (
    <>
      <Card title="When Vitra opens">
        <ToggleRow
          label="Scan libraries on start"
          checked={settings.scanOnStart}
          onChange={(scanOnStart) => onChange({ scanOnStart })}
        />
        <ToggleRow
          label="Start in big picture"
          checked={settings.bigPictureOnStart}
          onChange={(bigPictureOnStart) => onChange({ bigPictureOnStart })}
        />
        <ToggleRow
          label="Start with Windows"
          hint={packaged ? undefined : 'Installed app only'}
          checked={settings.openAtLogin}
          onChange={(openAtLogin) => onChange({ openAtLogin })}
        />
        {settings.openAtLogin && (
          <ToggleRow
            label="Start in tray"
            checked={settings.startInTray}
            onChange={(startInTray) => onChange({ startInTray })}
          />
        )}
      </Card>
      <Card title="Closing the window">
        <ToggleRow
          label="Keep running in the tray"
          checked={settings.closeToTray}
          onChange={(closeToTray) => onChange({ closeToTray })}
        />
      </Card>
      <Card title="Big picture">
        <Row
          label="Big picture mode"
        >
          <button onClick={onOpenBigPicture} className={quietButton}>
            <Tv className="h-3.5 w-3.5" />
            Open now
          </button>
        </Row>
      </Card>
      <Card title="While you play">
        <ToggleRow
          label="Track playtime"
          checked={settings.trackPlaytime}
          onChange={(trackPlaytime) => onChange({ trackPlaytime })}
        />
        <ToggleRow
          label="Minimise when a game starts"
          checked={settings.minimiseOnLaunch}
          onChange={(minimiseOnLaunch) => onChange({ minimiseOnLaunch })}
        />
      </Card>
    </>
  )

  const library = (
    <>
      <Card title="Scanning">
        <Row
          label="Rescan libraries"
          hint={
            lastScan ? (
              <>
                Last scan: {lastScan.added} added, {lastScan.updated} updated
                {lastScan.missing ? `, ${lastScan.missing} missing` : ''}
                {lastScan.errors.length ? ` · ${lastScan.errors.length} warning(s)` : ''}
              </>
            ) : undefined
          }
        >
          <button
            onClick={onScan}
            disabled={scanning}
            className="flex h-9 shrink-0 items-center gap-2 rounded-[10px] bg-accent px-3.5 text-[12px] font-semibold text-black shadow-[0_6px_20px_-6px_rgb(var(--accent-rgb)/0.9)] transition-colors hover:bg-accent-strong disabled:opacity-60"
          >
            {scanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {scanning ? 'Scanning' : 'Rescan now'}
          </button>
        </Row>
        <Row
          label="Steam folder"
          hint={
            <>
              <span className="block truncate text-dim">
                {settings.steamPath ?? 'Detected automatically'}
              </span>
            </>
          }
        >
          <button onClick={onPickSteamPath} className={quietButton}>
            <FolderSearch className="h-3.5 w-3.5" />
            Browse
          </button>
        </Row>
      </Card>

      <Card title="Programs">
        <div className="py-4">
          <div
            role="radiogroup"
            aria-label="Where programs appear"
            className="grid grid-cols-3 gap-1 rounded-[11px] bg-black/20 p-1"
          >
            {PROGRAMS_OPTIONS.map((option) => {
              const selected = settings.programsView === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChange({ programsView: option.value })}
                  className={`h-8 rounded-[8px] text-[12px] transition-colors ${
                    selected
                      ? 'bg-accent/20 font-medium text-ink shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/0.45)]'
                      : 'text-muted hover:bg-white/6 hover:text-ink'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      </Card>

      <Card title="Backup">
        <BackupRow
          label="Back up"
          action="Save"
          icon={<Download className="h-3.5 w-3.5" />}
          done="Saved"
          run={() => window.launcher.exportBackup?.()}
        />
        <BackupRow
          label="Restore"
          action="Open"
          icon={<Upload className="h-3.5 w-3.5" />}
          done="Restored"
          run={() =>
            window.launcher.importBackup?.().then((result) => {
              if (result.ok) forgetMissingArt()
              return result
            })
          }
        />
      </Card>
    </>
  )

  const appearance = (
    <>
      <Card title="Wallpaper">
        <div className="hairline-b py-4 last:border-0">
          <div role="radiogroup" aria-label="Wallpaper" className="grid grid-cols-5 gap-2">
            {PRESETS.map((preset) => (
              <WallpaperTile
                key={preset.id}
                label={preset.name}
                selected={settings.wallpaper === preset.id}
                onClick={() => onChange({ wallpaper: preset.id })}
              >
                <img src={preset.src} alt="" draggable={false} className="h-full w-full object-cover" />
              </WallpaperTile>
            ))}
            {settings.backgroundImage ? (
              <WallpaperTile
                label="Your image"
                selected={settings.wallpaper === 'custom'}
                onClick={() => onChange({ wallpaper: 'custom' })}
              >
                <img
                  src={artUrl(settings.backgroundImage)}
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              </WallpaperTile>
            ) : (
              <WallpaperTile label="Your image" selected={false} onClick={onPickBackground}>
                <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 border border-dashed border-white/15 text-[11.5px] text-muted">
                  <ImageIcon className="h-4 w-4" />
                  Choose image
                </span>
              </WallpaperTile>
            )}
          </div>
          {settings.backgroundImage && (
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={onPickBackground} className={quietButton}>
                <ImageIcon className="h-3.5 w-3.5" />
                Choose image
              </button>
              <button
                onClick={onClearBackground}
                aria-label="Remove your image"
                title="Remove your image"
                className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-muted hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <Row label="Theme">
          <div role="radiogroup" aria-label="Theme" className="glass-soft inline-flex rounded-[10px] p-1">
            {(['auto', 'light', 'dark'] as const).map((theme) => {
              const selected = settings.theme === theme
              return (
                <button
                  key={theme}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChange({ theme })}
                  className={`h-7 rounded-[7px] px-3.5 text-[12px] capitalize transition-colors ${
                    selected ? 'bg-white/12 text-ink' : 'text-dim hover:text-ink'
                  }`}
                >
                  {theme}
                </button>
              )
            })}
          </div>
        </Row>

        {palette && (
          <ToggleRow
            label="Match colours to the image"
            checked={settings.matchBackgroundColours}
            onChange={(matchBackgroundColours) => onChange({ matchBackgroundColours })}
          />
        )}

        <div className="hairline-b py-4 last:border-0">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-[13px] text-ink">Dim</span>
            <span className="text-[11.5px] tabular-nums text-dim">
              {Math.max(MIN_DIM, settings.backgroundDim)}%
            </span>
          </div>
          <input
            type="range"
            min={MIN_DIM}
            max={100}
            step={1}
            value={Math.max(MIN_DIM, settings.backgroundDim)}
            aria-label="Background dim"
            onChange={(event) => onChange({ backgroundDim: Number(event.target.value) })}
            className="vitra-range w-full"
          />
        </div>

        <ToggleRow
          label="Particles"
          checked={settings.backgroundParticles}
          onChange={(backgroundParticles) => onChange({ backgroundParticles })}
        />
      </Card>

      <Card title="Screen saver">
        <Row
          label="Start after"
        >
          <Dropdown
            label="Screen saver starts after"
            value={String(settings.screenSaverMinutes)}
            onChange={(value) => onChange({ screenSaverMinutes: Number(value) })}
            options={SCREEN_SAVER_OPTIONS}
          />
        </Row>
        <Row label="Preview">
          <button onClick={onPreviewScreenSaver} className={quietButton}>
            <MonitorPlay className="h-3.5 w-3.5" />
            Preview
          </button>
        </Row>
      </Card>
    </>
  )

  const connections = (
    <>
      <Card title="Discord">
        <ToggleRow
          label="Show what you're playing"
          hint={discordReady ? undefined : 'Unavailable in this build'}
          checked={settings.discordPresence}
          onChange={(discordPresence) => onChange({ discordPresence })}
        />
      </Card>
      <Card title="Keys">
        <KeyField
          label="Steam Web API key"
          hint="steamcommunity.com/dev/apikey"
          saved={Boolean(settings.keysSet?.steamWebApiKey)}
          onCommit={(steamWebApiKey) => onChange({ steamWebApiKey })}
        />
        <KeyField
          label="Xbox key (OpenXBL)"
          hint="xbl.io"
          saved={Boolean(settings.keysSet?.xboxApiKey)}
          onCommit={(xboxApiKey) => onChange({ xboxApiKey })}
        />
        <KeyField
          label="SteamGridDB key"
          hint="steamgriddb.com"
          saved={Boolean(settings.keysSet?.steamGridDbKey)}
          onCommit={(steamGridDbKey) => onChange({ steamGridDbKey })}
        />
      </Card>
    </>
  )

  const about = (
    <>
      <Card>
        <div className="flex items-center gap-4 py-4">
          <img
            src={developerAvatar}
            alt="MindlZ"
            draggable={false}
            className="h-14 w-14 shrink-0 rounded-full border border-white/10 object-cover shadow-[0_4px_18px_-6px_rgb(var(--accent-rgb)/0.6)]"
          />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[20px] leading-tight font-bold text-ink [font-stretch:85%]">
              Vitra
            </div>
            <div className="text-[12px] text-muted">
              Made by MindlZ{version && <span className="tabular-nums"> · Version {version}</span>}
            </div>
          </div>
          <button onClick={() => window.open(KOFI_URL, '_blank')} className={`group ${quietButton}`}>
            <CoffeeIcon className="h-3.5 w-3.5" />
            Buy me a coffee
          </button>
        </div>
      </Card>

      <Card title="Updates">
        <Row
          label={update ? describeUpdate(update) : 'Updates'}
          hint={
            update?.status === 'available' && update.releaseUrl ? (
              <button
                onClick={() => window.open(update.releaseUrl, '_blank')}
                className="text-dim underline decoration-white/20 underline-offset-2 transition-colors hover:text-ink"
              >
                What's new
              </button>
            ) : undefined
          }
        >
          {update?.status === 'available' ? (
            <button
              onClick={() => void window.launcher.installUpdate()}
              className="flex h-9 shrink-0 items-center gap-2 rounded-[10px] bg-accent px-3.5 text-[12px] font-semibold text-black shadow-[0_6px_20px_-6px_rgb(var(--accent-rgb)/0.9)] transition-colors hover:bg-accent-strong"
            >
              <Download className="h-3.5 w-3.5" />
              Update now
            </button>
          ) : update?.status === 'downloading' || update?.status === 'installing' ? (
            <div className="h-1.5 w-[120px] overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${update.percent ?? 0}%` }}
              />
            </div>
          ) : (
            <button
              onClick={() => void window.launcher.checkForUpdates?.()}
              disabled={!update || update.status === 'unavailable' || update.status === 'checking'}
              className={quietButton}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${update?.status === 'checking' ? 'animate-spin' : ''}`} />
              Check now
            </button>
          )}
        </Row>
        <ToggleRow
          label="Check automatically"
          checked={settings.checkForUpdates}
          onChange={(checkForUpdates) => onChange({ checkForUpdates })}
        />
        <Row label={`What's new in ${RELEASES[0].version}`}>
          <button onClick={onOpenWhatsNew} className={quietButton}>
            <Sparkles className="h-3.5 w-3.5" />
            Show
          </button>
        </Row>
      </Card>

      <Card title="What it is">
        <p className="py-4 text-[12px] leading-relaxed text-muted">
          One library for your Steam, Epic, GOG, Xbox and local games, built from the files already
          on your PC. No accounts: the only things fetched online are cover art, game names, new
          versions from GitHub and, if you add a key, your friends list. It's free and always will be. If it's earned a place on
          your PC, a tip is welcome but never expected.
        </p>
      </Card>

      <Card title="Licence">
        <Row
          label="GNU General Public License v3.0"
        >
          <button onClick={() => window.open(LICENCE_URL, '_blank')} className={quietButton}>
            <Scale className="h-3.5 w-3.5" />
            Read it
          </button>
        </Row>
      </Card>
    </>
  )

  const content: Record<SectionId, ReactNode> = {
    general,
    library,
    appearance,
    connections,
    about
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 pt-[84px] backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="glass-strong animate-fade-up flex h-[min(620px,calc(100vh-120px))] w-[800px] max-w-[calc(100vw-56px)] overflow-hidden rounded-[16px]"
        onClick={(event) => event.stopPropagation()}
      >
        <nav aria-label="Settings sections" className="hairline-r flex w-[204px] shrink-0 flex-col bg-black/20 px-3 py-5">
          <h2 className="px-2.5 pb-4 font-display text-[21px] font-bold text-ink [font-stretch:85%]">
            Settings
          </h2>
          <div className="flex flex-col gap-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const active = id === section
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => open(id)}
                  data-nav-view={id}
                  aria-current={active ? 'page' : undefined}
                  className={`group relative flex h-[36px] items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13px] transition-colors ${
                    active
                      ? 'bg-white/8 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]'
                      : 'text-dim hover:bg-white/5 hover:text-ink'
                  }`}
                >
                  {active && (
                    <span className="vitra-sun absolute top-1/2 -left-[5px] h-[7px] w-[7px] -translate-y-1/2" />
                  )}
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      active ? 'text-accent' : 'text-muted group-hover:text-dim'
                    }`}
                  />
                  {label}
                </button>
              )
            })}
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-start justify-between gap-4 px-7 pt-6 pb-5">
            <div className="min-w-0">
              <h3 className="font-display text-[24px] leading-tight font-bold text-ink [font-stretch:85%]">
                {current.label}
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{current.blurb}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close settings"
              className="-mt-1 -mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/8 hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* keyed: each section starts scrolled to the top */}
          <div key={section} className="animate-fade-up min-h-0 flex-1 overflow-y-auto px-7 pb-7">
            {content[section]}
          </div>
        </div>
      </div>
    </div>
  )
}
