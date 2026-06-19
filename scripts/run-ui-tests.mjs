import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const baseUrl = 'http://127.0.0.1:5173'
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const playwrightCli = path.join(rootDir, 'node_modules', '@playwright', 'test', 'cli.js')

const vite = await createServer({
  root: rootDir,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
await vite.listen()
vite.printUrls()

try {
  await waitForServer(baseUrl)
  const exitCode = await runPlaywright(process.argv.slice(2))
  process.exitCode = exitCode
} finally {
  await vite.close()
}

async function waitForServer(url) {
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Keep waiting until Vite is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function runPlaywright(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [playwrightCli, 'test', ...args], {
      stdio: 'inherit',
    })
    child.on('exit', (code) => {
      resolve(code ?? 1)
    })
  })
}
