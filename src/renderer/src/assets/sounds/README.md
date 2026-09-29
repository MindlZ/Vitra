# UI sounds

Audio files here (`.mp3`, `.ogg` or `.wav`) are bundled at build time; the file
name picks the sound:

| File name    | Plays when                                            |
| ------------ | ----------------------------------------------------- |
| `card-hover` | a library card is hovered or focused (restarts, never stacks) |
| `card-leave` | the card is un-hovered (optional, not currently present) |
| `startup`    | the app opens, with the sunrise splash                |
| `ui-click`   | any button is pressed — mouse, keyboard or controller |

Missing files are simply silent. Volume is set in `lib/sound.ts`.
