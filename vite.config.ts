import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isGitHubPages = mode === 'github'

  return {
    base: isGitHubPages ? '/pdf-merge/' : '/',
    plugins: [react()],
  }
})
