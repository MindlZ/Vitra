<p align="center">
  <img src="resources/icon.png" alt="Vitra" width="120" />
</p>

<h1 align="center">Vitra</h1>

<p align="center">
  A game launcher for Windows.<br />
  Steam, Epic, GOG, Xbox and your own games in one library.
</p>

<p align="center">
  <a href="https://github.com/MindlZ/Vitra/releases/latest"><img src="https://img.shields.io/github/v/release/MindlZ/Vitra?style=flat-square&color=ff894f&label=version" alt="Latest version" /></a>
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

Vitra builds one library from every store on your PC, installed or owned. It
tracks playtime, shows which friends are online, and has a fullscreen big
picture mode for the TV.

It reads the files your launchers already keep. No accounts, no sign-in. Games
still launch through their own store, so ownership, cloud saves and anti-cheat
are untouched.

## Contents

- [Features](#features)
- [Getting started](#getting-started)
  - [Install](#install)
  - [API keys](#api-keys-optional)
  - [Discord status](#discord-status-optional)
  - [Captures](#captures)
  - [Big picture and controllers](#big-picture-and-controllers)
  - [Starting with Windows](#starting-with-windows)
- [Maintenance](#maintenance)
- [Forks and security](#forks-and-security)
- [Building from source](#building-from-source)
- [Author](#author)
- [Licence](#licence)

## Features

### One library

Steam, non-Steam shortcuts, Epic, GOG, Xbox / Game Pass and any `.exe`, in one
grid. Owned games that aren't installed appear alongside, ready to install.
Cover art is fetched automatically. Sort, search, favourite and tag anything.

<p align="center">
  <img src="docs/images/library.jpg" alt="The library" width="900" />
</p>

### Game pages

Artwork, time played, last played, and your Steam and Xbox Game Bar captures
for every game. Playtime is tracked for all of them, including games Steam
never counted. Existing Steam hours are imported on first run.

<p align="center">
  <img src="docs/images/game.jpg" alt="A game's page" width="900" />
</p>

### Home

A clock, a visualiser driven by whatever your PC is playing, the last game you
played, and friends online. Left alone, it becomes a screen saver.

<p align="center">
  <img src="docs/images/home-moon.jpg" alt="The home screen" width="900" />
</p>

### Big picture mode

Fullscreen and built for a controller. Browse, launch, and sleep, restart or
shut down the PC from the couch.

<p align="center">
  <img src="docs/images/big-picture.jpg" alt="Big picture mode" width="900" />
</p>

### Wallpapers and themes

Four built-in wallpapers, or any image of your own. The interface takes its
colours from the wallpaper and switches between light and dark to match.

<p align="center">
  <img src="docs/images/home-smoke.jpg" alt="The light theme" width="900" />
</p>

### Also

- Controller support throughout
- Discord Rich Presence
- A separate Programs tab for apps like Wallpaper Engine
- Tray mode and start with Windows
- Automatic updates

## Getting started

### Install

1. Download `Vitra-Setup-<version>.exe` from the
   [latest release](https://github.com/MindlZ/Vitra/releases/latest).
2. Run it. The installer isn't code-signed, so SmartScreen may show a warning:
   **More info → Run anyway**.
3. Choose the install folder and whether to install for yourself or everyone.

Vitra scans your stores on first launch. Everything below is optional.

### API keys (optional)

Two free keys enable extra features. Both are entered in **Settings →
Connections**, encrypted with your Windows account, and only ever sent to
their own service.

| Key | Enables | Get it from |
| --- | --- | --- |
| Steam Web API key | Online friends and what they're playing | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) |
| SteamGridDB API key | Cover art for non-Steam games | [steamgriddb.com](https://www.steamgriddb.com/profile/preferences/api) |

#### Steam Web API key

1. Open [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
   and sign in.
2. Enter any domain (`localhost` works), accept the terms and click **Register**.
3. Paste the key into **Settings → Connections → Steam Web API key**.
4. Set your friends list to public: **Steam profile → Edit Profile → Privacy
   Settings → Friends List: Public**.

#### SteamGridDB API key

1. Sign in at [steamgriddb.com](https://www.steamgriddb.com).
2. Open [Preferences → API](https://www.steamgriddb.com/profile/preferences/api)
   and click **Generate API Key**.
3. Paste the key into **Settings → Connections → SteamGridDB key**.
4. Restart Vitra to fetch the missing art.

Any game's cover and background can also be set by hand from its page.

### Discord status (optional)

1. Enable **Settings → Connections → Show what you're playing**.
2. Run the Discord desktop app.
3. In Discord, enable **User Settings → Activity Privacy → Share your detected
   activities with others**.

Games launched from Vitra then appear on your Discord profile.

### Captures

No setup. Screenshots from Steam (**F12**) and the Xbox Game Bar
(**Win + Alt + PrtScn**, clips with **Win + Alt + G**) appear on each game's page.

### Big picture and controllers

Open with the **TV button** in the title bar, **F11**, or **View** on a
controller. To launch straight into it: **Settings → General → Start in big
picture**.

| Button | Action |
| ------ | ------ |
| A | Play / select |
| B | Back |
| X | Details |
| Y | Favourite |
| LB / RB | Switch tabs |
| Menu | Settings |
| View | Exit big picture |

Xbox controllers work out of the box.

### Starting with Windows

**Settings → General → Start with Windows** launches Vitra to the tray at
sign-in. Closing the window keeps it in the tray, so playtime keeps tracking.
Quit from the tray icon.

## Maintenance

Vitra is developed in my spare time. Issues and feature requests are read, but
responses and fixes aren't on a schedule. Pull requests are welcome.

## Forks and security

Vitra is open source, so anyone can publish a modified version. A launcher has
access to your game library and runs programs on your PC, which makes it an
easy target for bundled trackers or malware.

- Download Vitra only from [this repository's releases](https://github.com/MindlZ/Vitra/releases).
- Only use a fork if you trust its author and can read its source.
- Vitra never asks for an account, a password, or to install other software.
  Treat any copy that does as unsafe.

## Building from source

Requires [Node.js](https://nodejs.org) 22+ on Windows.

```bash
npm install
npm run dev    # run with hot reload
npm run dist   # build the installer into dist/
```

Updates only work in the installed app. Release steps are in
[How it works](docs/how-it-works.md#updates-and-releases).

## Author

<img src="docs/images/mindlz.jpg" alt="MindlZ" width="80" align="left" />

Built by **MindlZ**. If Vitra is useful to you, you can support it on
[Ko-fi](https://ko-fi.com/mindlz).

<br clear="left" />

## Licence

[GNU General Public License v3.0](LICENSE). Vitra is free to use, study, change
and share. Distributed modifications must stay open source under the same
licence.
