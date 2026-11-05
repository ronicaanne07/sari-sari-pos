import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ensureSeeded } from './db/seed'
import { resumeAutoCloudBackup } from './db/cloud'

async function boot() {
  await ensureSeeded()
  // Ask the browser not to evict our data when the phone is low on storage.
  resumeAutoCloudBackup()
  navigator.storage?.persist?.().catch(() => {})
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
