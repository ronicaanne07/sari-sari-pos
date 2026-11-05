import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ensureSeeded } from './db/seed'
import { cloudConfigured, resumeAutoCloudBackup } from './db/cloud'

async function boot() {
  // With the shared online store, a new phone must download the real catalogue, not invent sample products.
  if (!cloudConfigured()) await ensureSeeded()
  resumeAutoCloudBackup()
  // Ask the browser not to evict our data when the phone is low on storage.
  navigator.storage?.persist?.().catch(() => {})
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
