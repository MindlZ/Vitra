# UI sounds

Audio files here (`.mp3`, `.ogg` or `.wav`) are bundled at build time; the file
name picks the sound:

| File name    | Plays when                                            |
| ------------ | ----------------------------------------------------- |
| `big-picture-enter` | big picture mode opens, with the curtain (restarts) |
| `big-picture-exit` | big picture mode closes, with the curtain (restarts) |
| `card-hover` | a library card is hovered or focused (restarts, never stacks) |
| `card-leave` | the card is un-hovered (optional, not currently present) |
| `store-scroll` | the sidebar's store carousel turns (wheel or Up/Down; restarts) |
| `startup`    | the app opens, with the sunrise splash                |
| `ui-click`   | any button is pressed — mouse, keyboard or controller |

Missing files are simply silent. Volume is set in `lib/sound.ts`.
