import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '../styles/app.css'
import { App } from './App'
import { loadSettings } from '../store/settings'

async function start() {
  await loadSettings()
  createRoot(document.getElementById('root')!).render(<App />)
}

void start()
