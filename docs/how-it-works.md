# How Vitra works

A custom game launcher for Windows. It builds one library out of your installed
Steam and Epic games, the non-Steam shortcuts you've added to Steam, the games
you own but haven't installed, and any local executables you add — then tracks
how long you play and lets you organise it all with favourites and tags.

Everything is read from local store files. No accounts, no API keys. The only
network traffic is cover art from Valve's CDN, name lookups on Steam's public
store endpoint, and a check for new versions on this project's GitHub Releases
(which can be turned off). Lyrics, if you turn them on, come from lrclib.net,
which is sent the title, artist, album and length of what's playing.

## Stack

| Layer    | Choice                                      |
| -------- | ------------------------------------------- |
| Shell    | Electron 44 (`electron-vite`)               |
| UI       | React 19 + Tailwind CSS v4 + `lucide-react` |
| Language | TypeScript                                  |
| Storage  | A single JSON file in Electron's `userData` |

## Commands

```bash
npm run dev      # run the launcher with hot reload
npm run build    # type-strip and bundle into out/
```

## How it works

### Scanning

These sources feed the library:

- **Installed Steam games** — the install path comes from the registry
  (`HKCU\Software\Valve\Steam`), `steamapps/libraryfolders.vdf` gives every
  library drive, then each `appmanifest_*.acf` is parsed. Only apps flagged fully
  installed are imported, and runtimes/redistributables are dropped by app id and
  name.
- **Non-Steam shortcuts** — games you added to Steam yourself live only in
  `userdata/<id>/config/shortcuts.vdf`, a *binary* KeyValues file with no app
  manifest. These are parsed separately and launched via their executable.
- **Owned but not installed** — `localconfig.vdf` lists every app tied to the
  account. Anything not on disk is looked up on Steam's public store endpoint for
  its name and type, which is also what filters out DLC, soundtracks and demos:
  only `type: "game"` is kept. Results are cached on disk, so this costs requests
  only the first time an app is seen.
- **Epic** — the `.item` JSON manifests in
  `%PROGRAMDATA%\Epic\EpicGamesLauncher\Data\Manifests`, skipping DLC and add-ons.
  Owned-but-uninstalled games come from the launcher's catalogue cache
  (`Data\Catalog\catcache.bin`, base64 JSON), filtered to Windows games that
  aren't DLC, add-ons, audiences or test builds. It also supplies box art.
  Installing opens the launcher's own install dialog (`?action=install`).
- **GOG** — installed games from `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games`
  (launched straight from the exe; GOG is DRM-free). The owned library, titles
  and covers come from GOG Galaxy's `galaxy-2.0.db`, read with Node's built-in
  `node:sqlite` (no native module). Without Galaxy, only installed games show.
- **Xbox / Game Pass** — `.GamingRoot` at each drive root names the Xbox app's
  install folders; each game's `appxmanifest.xml` and `MicrosoftGame.config`
  give its identity, name, executables and art. Launched by app id through
  `shell:AppsFolder`, like the Start menu. Installed games only: the owned
  library is behind an Xbox Live sign-in.

- **Battle.net, EA app, Ubisoft Connect and Riot** — all from Windows'
  Uninstall keys (`scanners/launchers.ts`), where each launcher registers its
  games; one `reg query /s` per hive instead of four private formats
  (Battle.net's own is protobuf). Battle.net entries carry `--uid=<product>`
  in their uninstall command; EA entries run EAInstaller's `Cleanup.exe` and
  name the game exe as their icon (the content id comes from
  `__Installer\installerdata.xml`; EA copies of Steam games are skipped);
  Ubisoft keys are `Uplay Install <id>`; Riot keys are
  `Riot Game <product>.<patchline>`. Uninstall entries can outlive the game,
  so each install folder must exist. Installed games only: the owned
  libraries are behind each store's sign-in.

Plus local executables you pick yourself.

**The same game on two stores is one card** (`lib/duplicates.ts`, renderer
only). Copies are matched by a normalised title (case, accents, ™/®,
punctuation and `&` ignored; "Doom" and "Doom 3" stay apart), skipping local
files and hidden games (hiding a copy is how to split a wrong match). One copy
stands in: the store the user picked under **Launch from** on the game page
(`preferredStore`, written to every copy), else an installed one, else the
most played, else Steam first. Playtime and sessions are summed for display;
each copy keeps its own on disk. Store lenses, sidebar counts and big
picture's tabs include a game under every store it's on (`hasSource`), and a
session on any copy shows on the stand-in's card.

A library on a drive that isn't connected is never deleted. Those games are
flagged `installed: false` and keep their playtime.

Uninstalled games are part of the library, not a separate area: they appear in
**All games** and every other view, dimmed and marked with a badge, and sort
after installed titles so they never outrank something you can actually play.
**Not installed** is a lens onto the same set rather than a partition of it, and
their Play button becomes **Install**.

### Big picture mode

A fullscreen, controller-first view for playing from the sofa. Open it with
the TV button in the title bar, **F11**, the controller's **View** button, or
set it to start that way in Settings → General. Tabs along the top (switch
with LB/RB) sit over a shelf of covers; the selected game's art fills the
screen. **A** plays, **X** opens details, **Y** favourites, **B** steps back,
and **View** leaves. Home keeps the clock, visualiser, Now playing and
friends, with a single Continue tile for the game you last played. The Power
button sleeps, restarts or shuts down the PC, like a console. Restart and shut
down count down for five seconds first (B cancels), and save any play session
in progress. Mouse and keyboard work too: click to
select, double-click or Enter to play.

### Tray, startup and screen saver

Closing the window hides Vitra to the tray, so playtime keeps tracking; quit
from the tray icon (or turn this off in Settings → General). **Start with
Windows** starts it quietly in the tray at sign-in (installed app only).

After a few minutes without input (Settings → Appearance; 5 by default),
the screen saver takes over: the title bar and sidebar slide away, then the
clock, what's playing with its album art, and the visualiser fade up. The
layout drifts slowly so nothing burns in. Any key, click or controller
button brings you back, and that input doesn't also press anything.

### Captures

A game's page shows the screenshots and clips you've taken of it, when there
are any: Steam screenshots (matched by app id), the Xbox Game Bar's Captures
folder (matched by the window title in each file name), and recorders that
file by game in a folder of Videos (such as NVIDIA's). Click one to view it
full size, step through with the arrows, play clips, or show the file in
Explorer. Nothing is copied; thumbnails are made once and cached.

### Discord status

Optional (Settings → Connections, off by default). While a game you launched
from Vitra is running, your Discord status shows it with how long you've been
playing. It talks to the Discord app on your PC directly; nothing goes over
the network, and closing the game clears it.

### Launching

Steam and Epic games start through their own clients (`steam://rungameid/…` and
`com.epicgames.launcher://apps/…`) so ownership and anti-cheat checks still pass.
Shortcuts and local games are spawned directly. For an uninstalled Steam game the
same URI opens Steam's install prompt, so the button reads **Install** and no
playtime session is started.

Battle.net, Riot and Ubisoft games also start through their launcher (the
`launcher` field, set only by the scan): `Battle.net.exe --exec="launch
<code>"` (older products have their own short codes, newer ones are the uid
upper-cased), `RiotClientServices.exe --launch-product=… --launch-patchline=…`,
and `uplay://launch/<id>/0`. EA games run their own exe, which hands itself to
the EA app for sign-in.

**Programs that come along** (`main/companions.ts`): per game, programs to
start with it, an option to close them when it ends, and one program or script
to run afterwards. Paths only come from main's own file dialog. One that's
already running is neither started twice nor closed afterwards. Only exes can
be closed (Vitra holds their pid; it's a polite `taskkill` without `/f`);
shortcuts and scripts go through the shell. The end actions need playtime
tracking on, and don't run when the watch was cancelled (quitting Vitra,
Stop tracking), since the game may still be running.

### Playtime

Because store games are launched by URI, Vitra never owns the process, so it
polls `tasklist` instead:

1. Work out which executables count as "this game". Epic publishes this in its
   manifest (`ProcessNames`); for everything else the install folder is walked and
   candidates are ranked by name similarity and path shape (`Binaries/Win64/…`
   scores highly), with installers, crash handlers and prereq bundles excluded.
2. Wait up to three minutes for one of those processes to appear.
3. Count until it's been gone for two consecutive polls, so a bootstrapper handing
   off to the real game doesn't end the session early.

Sessions under 30 seconds are discarded. On first import, Steam's own recorded
hours are read from `localconfig.vdf` so totals look right immediately instead of
starting at zero. The detail page shows which process names a game is tracked by,
and a **Stop tracking** button in case the wrong one was picked up.

Every counted session is also logged with its start and end
(`main/sessions.ts`, `sessions.json`), which is what **Stats** draws: hours
per week, a 26-week calendar and the last 30 days' most played. Seeded Steam
hours and anything from before the log have no dates, so the totals come from
the library and the charts from the log. A session past midnight counts on
both days.

### Achievements

With a Steam key, a game with a Steam copy shows how many achievements are
unlocked and the three rarest (`main/achievements.ts`): `GetPlayerAchievements`
for what's unlocked (needs **Game details: Public** on the profile, else Steam
answers 403 and the page says it's private), `GetSchemaForGame` for names and
icons, and the keyless `GetGlobalAchievementPercentagesForApp` for rarity.
Cached per app for 10 minutes; failures aren't cached.

### Backup

Settings → Library → Backup writes one `.vitrabackup` file (JSON): the games,
settings, session log, and only the images the user picked (their
`<id>-<kind>-<timestamp>` names tell them apart from downloaded art, which
comes back on its own). API keys are never included; restoring keeps this
PC's keys and Steam folder. Restoring asks first, validates every game
through `normaliseGame`, and only writes art files with plain names, so a
crafted file can't write outside `art\`.

### Artwork

`art.ts` walks an ordered ladder per game and stops at the first hit. Local
sources rank above the network, and specific sources above generic ones:

1. **What you set in Vitra** — Set cover / Set background.
2. **Art you customised inside Steam** (`userdata/<id>/config/grid`). This is the
   only source that covers non-Steam shortcuts, so it outranks everything remote.
3. **Steam's CDN**, across every capsule size, then Valve's second asset host as
   a fallback. Portrait capsules first; a cropped real cover still beats a
   generated one, so the wide header is the last of these.
4. **The store API's canonical URLs**, reusing the lookup cache the owned-games
   scan already fills.
5. **Whatever the scanner attached** — Epic's vault thumbnail.
6. **SteamGridDB**, if a key is configured. The only source with art for Epic
   titles, shortcuts and local executables, which is why it's worth the key.
7. **The executable's own icon**, via `app.getFileIcon`. A poor cover but an
   honest one, and it needs no network. These are marked `.icon.png` in the cache
   so the renderer letterboxes them onto a tinted plate instead of cropping a
   square image to a 2:3 card.
8. **A generated plate** — a gradient keyed to a hash of the title, stable across
   restarts.

Art is fetched once, cached under `userData/art`, and served to the renderer over
a custom `applib://` protocol. Requests are queued five at a time, and identical
in-flight requests are shared, so opening a large library doesn't fire hundreds
of downloads. Failures are remembered so they aren't retried every render — a
rescan, or adding a key, clears that.

### Friends

The friends rail shows who's online, in-game first. It needs a free Steam Web API
key (Settings → Connections); the SteamID64 comes from `config/loginusers.vdf`,
so there's nothing to look up by hand. Your friends list also has to be public —
Steam returns the same 401 for that as it does for a bad key, so the panel says
so rather than guessing.

Results are cached for 45 seconds in the main process and the panel refreshes
once a minute, so an open rail doesn't hammer the API.

**Joining.** When `GetPlayerSummaries` reports a `lobbysteamid` (a joinable
Steam lobby) or a real `gameserverip` (a dedicated server), the friend is
`joinable`: the panel shows Join, and on Home their face gets an accent ring
and joins instead of opening their profile. The target
(`steam://joinlobby/<app>/<lobby>/<friend>` or `steam://connect/<ip>`) stays
in main; the renderer only sends a friend id (`friends:join`). If the game is
installed in the library it goes through `launchGame(id, via)`, so last played
and playtime tracking work as for any launch. Games with their own
matchmaking (Fortnite, Valorant and the like) never report either field, and
Steam's own "Join Game" uses rich presence that the Web API doesn't expose, so
Vitra will sometimes miss a join Steam offers. Xbox has no joinable data.

Xbox friends come from [OpenXBL](https://xbl.io) (`main/friendsXbox.ts`), a
third-party proxy for Xbox Live, with its own optional key. Xbox Live itself
needs a Microsoft sign-in flow that Vitra doesn't have. The response is Xbox's
PeopleHub shape passed through: `presenceState` gives online/away/offline, and
the primary `presenceDetails` entry with `IsGame` gives the game. It's cached
for 2 minutes (20 seconds on a forced refresh), since the free tier is 150
requests an hour. Both sources merge into one list sorted the same way; a
friend on both shows twice, since nothing links the two accounts. One source
failing doesn't hide the other's friends. Epic, GOG and PlayStation have no
key-based route: each would mean an account sign-in or borrowing another
app's login token.

### Look

Frosted glass over the wallpaper. `index.css` holds the whole system.

The backdrop (`Backdrop.tsx`) is three layers under the app: the wallpaper
blurred and scaled up, a veil that pulls it down to a usable dark, and grain.
Panels then `backdrop-filter` over all of it, so the glass picks up the
wallpaper's colour.

There are four bundled wallpapers (Vigil, Hex, Gate and Aurora, all dark, in
`assets/wallpapers/`), plus any image you choose. The bundled files are
pre-softened rather than blurred at full size: each source was downscaled hard
(96px wide) and scaled back up, a permanent blur that ships as ~80 KB and costs
nothing at runtime. The CSS blur on top only removes the last of its structure.
Each one comes with the colours Vitra would sample from it, so the UI matches.

Two deliberate details:

- The veil is thinnest over the **upper left**, so the wallpaper's glow lands behind
  the logo, and darker to the top right, behind the window controls (which
  Vitra draws itself, in `WindowControls.tsx`).
- Interactive states live *inside* the `glass-btn` utility rather than as
  separate `hover:bg-*` classes, so they can't lose to the base rule depending
  on how the two land in Tailwind's utilities layer. Focus uses the global
  `:focus-visible` outline instead of a border override, for the same reason.

Colour comes from the brand assets: magenta (`#ff6ecb`, hue ~318) is the
wallpaper's dominant hue and the logo's glow, and carries every primary action.
The sunset peach inside the mark (`--color-ember`) is used in exactly one place —
favourites — so the two never compete. Surfaces are plum-black so the pink reads
as glow rather than a colour cast.

The dials worth knowing: `--glass-fill` and `--glass-blur` control how present
the glass is, and the `body::after` veil controls how much wallpaper survives.

## Layout

```
src/
  main/              Electron main process
    index.ts         window, applib:// protocol, IPC handlers
    store.ts         library.json read/write (atomic, serialised)
    library.ts       scan orchestration and merge rules
    launch.ts        launching + session bookkeeping
    watcher.ts       process discovery and polling
    art.ts           art cache
    vdf.ts           Valve KeyValues parser (text)
    vdfBinary.ts     Valve KeyValues parser (binary, for shortcuts.vdf)
    paths.ts         registry and well-known path lookups
    sessions.ts      the session log behind Stats
    achievements.ts  Steam achievements
    backup.ts        .vitrabackup export/import
    companions.ts    programs started with a game
    scanners/        steam, steamShortcuts, steamPlaytime, steamStore, epic,
                     gog, xbox, launchers (Battle.net, EA, Ubisoft, Riot)
  preload/index.ts   contextBridge surface (window.launcher)
  shared/            types.ts, api.ts — shared by main and renderer
  renderer/src/      React app
resources/icon.png   window / taskbar icon
```

The renderer has no Node access. Everything goes through the typed
`window.launcher` bridge, and `game:patch` whitelists which fields the UI is
allowed to change.

## Data

`%APPDATA%\Vitra\` holds `library.json` (games and settings), `sessions.json`
(the play log behind Stats), `steam-app-info.json` (the store name/type cache)
and `art\` (cached images).
Deleting any of them is safe — a rescan rebuilds them, though hand-made tags and
covers live in `library.json`.

## Possible next steps

- Emulator/ROM scanners (the `scanners/` interface is ready for them)

## Installer

`npm run dist` builds Vitra and writes a Windows installer to
`dist/Vitra-Setup-<version>.exe`. The installer asks where to install and
whether for just you or everyone on the PC, adds Start menu and desktop
shortcuts, and never deletes your library or playtime on uninstall. It isn't
code-signed, so Windows SmartScreen asks for confirmation the first time.

## Updates and releases

The installed app updates itself from this repository's GitHub Releases.
The version is in Settings → About. When a newer release is out, an
**Update to x.y.z** button appears in the title bar (and Settings → About
has **Update now** and a link to what's new). It downloads the update,
installs it into the same folder and reopens; library and playtime are
untouched. It checks when Vitra opens and every six hours (Settings → About →
Check automatically), and nothing downloads until you choose to update.

To publish a release:

1. The repository must be public, and electron-builder has to know which one
   it is: add `"repository": "github:<owner>/<repo>"` to `package.json` (a
   git remote pointing at GitHub works too). This is baked into the installer,
   so builds made before it can't update themselves.
2. Raise `version` in `package.json` (e.g. `0.2.0`).
3. `npm run dist`. `dist/` then holds `Vitra-Setup-<version>.exe`, its
   `.blockmap` and `latest.yml`.
4. On GitHub, draft a release tagged `v<version>` (e.g. `v0.2.0`), attach
   those three files, and publish it. `latest.yml` is what installed copies
   read to find the update; the `.blockmap` lets them download only what
   changed.

Or let electron-builder upload them: set a `GH_TOKEN` environment variable
(a token with `repo` scope) and run `npx electron-vite build && npx
electron-builder --win --publish always`.

## Licence

Vitra is made by MindlZ and released under the
[GNU General Public License v3.0](LICENSE). You're free to use, study, share and
change it; if you distribute a modified version, it must stay under GPL-3.0 with
its source available.

It's free and always will be. If it's earned a place on your PC, a tip on
[Ko-fi](https://ko-fi.com/mindlz) is welcome but never expected.
