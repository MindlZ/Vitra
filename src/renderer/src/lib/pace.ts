// canvas animations ease off when Vitra isn't what you're looking at. rAF already
// stops when hidden, but not behind other windows or on a second monitor

let gameRunning = false

export function setGameRunning(on: boolean): void {
  gameRunning = on
}

// focused always runs full; unfocused is slow, or paused while a game runs
export function pace(): 'full' | 'slow' | 'paused' {
  if (document.hasFocus()) return 'full'
  return gameRunning ? 'paused' : 'slow'
}

// for css: html[data-focus='off'] pauses the endless animations
const markFocus = (): void => {
  document.documentElement.dataset.focus = document.hasFocus() ? 'on' : 'off'
}
window.addEventListener('focus', markFocus)
window.addEventListener('blur', markFocus)
markFocus()
