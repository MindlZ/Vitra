import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { LyricsWidget, VisualiserWidget } from './Widget'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import './index.css'
import { primeStartup } from './lib/sound'
import { restorePalette } from './lib/theme'

// main/widget.ts loads this same page as #widget (visualiser) or #lyrics
const widget = location.hash === '#widget' ? 'visualiser' : location.hash === '#lyrics' ? 'lyrics' : null

if (widget) document.documentElement.dataset.widget = widget
restorePalette()
// decode before React renders so it's ready the moment the window shows
if (!widget) void primeStartup()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {widget === 'visualiser' ? <VisualiserWidget /> : widget === 'lyrics' ? <LyricsWidget /> : <App />}
  </StrictMode>
)
