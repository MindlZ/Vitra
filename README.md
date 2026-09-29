<p align="center">
  <img src="resources/icon.png" alt="Vitra" width="120" />
</p>

<h1 align="center">Vitra</h1>

<p align="center">
  One library for all your PC games.<br />
  Steam, Epic, GOG, Xbox and anything else you play, in one quiet place.
</p>

<p align="center">
  <a href="https://github.com/MindlZ/Vitra/releases/latest"><img src="https://img.shields.io/github/v/release/MindlZ/Vitra?style=flat-square&color=ff894f&label=version" alt="Latest version" /></a>
  <a href="https://github.com/MindlZ/Vitra/releases"><img src="https://img.shields.io/github/downloads/MindlZ/Vitra/total?style=flat-square&color=ff894f" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-2b2233?style=flat-square" alt="Windows 10 and 11" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-2b2233?style=flat-square" alt="GPL-3.0" /></a>
</p>

<p align="center">
  <a href="https://github.com/MindlZ/Vitra/releases/latest"><b>Download</b></a>
  ·
  <a href="#getting-started">Getting started</a>
  ·
  <a href="#api-keys-optional">API keys</a>
  ·
  <a href="docs/how-it-works.md">How it works</a>
  ·
  <a href="https://ko-fi.com/mindlz">Support</a>
</p>

<p align="center">
  <img src="docs/images/home.jpg" alt="Vitra's home screen" width="900" />
</p>

---

## About

Vitra is a game launcher for Windows. It finds the games you already have,
installed or not, across every store on your PC, and puts them in one library.
It keeps track of how long you play, shows which friends are online, and has a
fullscreen big picture mode for playing on a TV with a controller.

It reads the files your launchers already keep on disk. There are no accounts
to make and nothing to sign in to. Steam, Epic, GOG and Xbox still launch your
games, so ownership, cloud saves and anti-cheat work exactly as they normally do.

## Features

### Every store, one library

Installed and owned Steam games, your non-Steam shortcuts, Epic, GOG, Xbox /
Game Pass, and any `.exe` you add yourself, all in one grid. Games you own but
haven't installed are there too, ready to install. Cover art comes in
automatically, and you can sort, search, favourite and tag everything.

<p align="center">
  <img src="docs/images/library.jpg" alt="The library" width="900" />
</p>

### A page for every game

Every game gets its own page with its artwork, how long you've played, when
you last played it, and your screenshots and clips from Steam and the Xbox Game
Bar. Playtime is tracked for every game, even ones Steam never counted, and
your existing Steam hours are imported when you first open Vitra.

<p align="center">
  <img src="docs/images/game.jpg" alt="A game's page" width="900" />
</p>

### A home screen worth leaving open

A clock, whatever's playing on your PC with a visualiser that moves to it, the
game you were last playing, and which friends are online. Leave it long enough
and it turns into a screen saver.

<p align="center">
  <img src="docs/images/home-moon.jpg" alt="The home screen" width="900" />
</p>

### Big picture mode

A fullscreen, controller-first view for playing on the TV. Browse your
library from the couch, launch games, and sleep, restart or shut down the PC
without getting up.

<p align="center">
  <img src="docs/images/big-picture.jpg" alt="Big picture mode" width="900" />
</p>

Its home screen comes with you, too.

<p align="center">
  <img src="docs/images/big-picture-home.jpg" alt="Big picture home" width="900" />
</p>

### Make it yours

Four wallpapers to choose from, or use any image of your own. Vitra takes its
colours from whichever you pick.

<p align="center">
  <img src="docs/images/settings.jpg" alt="Choosing a wallpaper in Settings" width="900" />
</p>

Light wallpapers get a light look, and dark ones a dark look, automatically.

<p align="center">
  <img src="docs/images/home-smoke.jpg" alt="The light look" width="900" />
</p>

### And also

- **Controller support** everywhere, not just in big picture.
- **Discord status** that shows the game you're playing.
- **A Programs tab** for apps like Wallpaper Engine, kept apart from your games.
- **Runs in the tray** so playtime keeps tracking, and can start with Windows.
- **Automatic updates** from this repository's releases.

## Getting started

### Install

1. Download `Vitra-Setup-<version>.exe` from the
   [latest release](https://github.com/MindlZ/Vitra/releases/latest).
2. Run it. Windows SmartScreen may warn you because the installer isn't
   code-signed (certificates cost money this project doesn't have). Click
   **More info → Run anyway**.
3. Choose where to install and whether it's just for you or everyone on the PC.

Vitra scans your stores the first time it opens. Everything works without any
of the optional setup below.

### API keys (optional)

Two free API keys unlock extras. Both go in **Settings → Connections**.

| Key | What it adds | Where to get it |
| --- | --- | --- |
| Steam Web API key | See which Steam friends are online and what they're playing | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) |
| SteamGridDB API key | Cover art for Epic, GOG, Xbox, non-Steam and your own games | [steamgriddb.com](https://www.steamgriddb.com/profile/preferences/api) |

Keys are encrypted with your Windows account before they're saved, and each is
only ever sent to the service it belongs to.

#### Steam Web API key

1. Go to [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
   and sign in with Steam.
2. Enter any domain name (`localhost` is fine), accept the terms and click
   **Register**.
3. Copy the key it shows you.
4. In Vitra, open **Settings → Connections** and paste it into **Steam Web API key**.
5. Make your **friends list** public, or Steam won't share it: Steam → your
   profile → **Edit Profile → Privacy Settings → Friends List: Public**.

#### SteamGridDB API key

Steam games already get their art automatically; this fills in everything else.

1. Sign in at [steamgriddb.com](https://www.steamgriddb.com) (you can use your
   Steam account).
2. Open [Preferences → API](https://www.steamgriddb.com/profile/preferences/api)
   and click **Generate API Key**.
3. Copy the key and paste it into **Settings → Connections → SteamGridDB key**.
4. Restart Vitra (quit from the tray icon and open it again) to fetch the
   missing art.

You can also set any image as a game's cover or background from its page.

### Discord status (optional)

1. Turn on **Settings → Connections → Show what you're playing**.
2. Make sure the **Discord desktop app** is running (the browser version can't
   receive it).
3. In Discord, open **User Settings → Activity Privacy** and turn on **Share
   your detected activities with others**.

Your status then shows the game while it's running, if you launched it from
Vitra.

### Captures

Nothing to set up. Screenshots you take with Steam (**F12**) or the Xbox Game
Bar (**Win + Alt + PrtScn**, or clips with **Win + Alt + G**) appear on that
game's page.

### Big picture and controllers

Open big picture with the **TV button** in the title bar, **F11**, or the
**View** button on your controller. It can also start that way: **Settings →
General → Start in big picture**.

| Button | Does |
| ------ | ---- |
| A | Play / select |
| B | Back |
| X | Game details |
| Y | Favourite |
| LB / RB | Switch tabs |
| Menu | Settings |
| View | Leave big picture |

Xbox controllers work out of the box. The Xbox button itself is reserved by
Windows for the Game Bar.

### Starting with Windows

**Settings → General → Start with Windows** starts Vitra quietly in the tray
when you sign in. Closing the window keeps it in the tray so playtime keeps
tracking; quit from the tray icon.

## About me

<img src="docs/images/mindlz.jpg" alt="MindlZ" width="96" align="left" />

Hi, I'm **MindlZ**. Vitra started as the launcher I wanted for my own PC: every
game in one place, and nice to look at while it's doing it. I'm sharing it in
case it's what you were after too.

If Vitra has earned a spot on your PC, you can
[buy me a coffee on Ko-fi](https://ko-fi.com/mindlz). It's never expected, but
always appreciated.

<br clear="left" />

## A personal project

Vitra is something I build in my spare time, for myself first and for anyone
else who finds it useful. Updates and bug fixes happen when I have the time
for them, so please don't expect quick replies to issues or feature requests.
I do read them, and good bug reports are always appreciated.

It's released under the [GNU General Public License v3.0](LICENSE). That means
it's free and open source, and anyone can use, study, change and share it. If
you fork it and release your own version, it has to stay open source under the
same licence, with its source code available. Contributions are welcome, here
or in your own fork.

## A word of caution about forks

Because Vitra is open source, anyone can take the code, change it and publish
their own version. Most people who do that mean well, but not all of them.

A launcher sees your whole game library and runs programs on your PC, which
makes a tampered copy an easy way to slip in trackers or malware. Be careful:

- Get Vitra from **[this repository's releases](https://github.com/MindlZ/Vitra/releases)**.
- Don't install a fork or a re-upload you found somewhere else unless you trust
  who made it and can see its source.
- Be wary of any "Vitra" that asks you to sign in to an account, asks for
  passwords, or comes bundled with other software. This one never does.

## Building from source

You'll need [Node.js](https://nodejs.org) 22 or newer, on Windows.

```bash
npm install
npm run dev    # run it with hot reload
npm run dist   # build the installer into dist/
```

Updates only work in the installed app, not when running from source.
Publishing a release is covered in [How it works](docs/how-it-works.md#updates-and-releases).

## Licence

Vitra is made by MindlZ and released under the [GNU General Public License v3.0](LICENSE).
