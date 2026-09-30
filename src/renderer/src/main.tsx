import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import './index.css'
import { primeStartup } from './lib/sound'
import { restorePalette } from './lib/theme'

restorePalette()
// decode before React renders so it's ready the moment the window shows
void primeStartup()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
