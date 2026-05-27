import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const isWindows = process.platform === 'win32'
const baseUrl = 'http://127.0.0.1:5173'
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteCli = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
const playwrightCli = path.join(rootDir, 'node_modules', '@playwright', 'test', 'cli.js')

const vite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--strictPort'], {
  stdio: 'inherit',
})

try {
  await waitForServer(baseUrl)
  const exitCode = await runPlaywright(process.argv.slice(2))
  process.exitCode = exitCode
} finally {
  await stopProcess(vite)
  process.exit(process.exitCode ?? 0)
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
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    let output = ''

    function handleOutput(chunk, stream) {
      const text = chunk.toString()
      output += text
      stream.write(text)
      const hasFailureSummary = /\d+\s+failed/.test(output)
      const hasPassSummary = /\d+\s+passed/.test(output)
      if (!settled && (hasFailureSummary || hasPassSummary)) {
        settled = true
        setTimeout(() => {
          stopProcess(child).finally(() => resolve(hasFailureSummary ? 1 : 0))
        }, 1000).unref()
      }
    }

    child.stdout.on('data', (chunk) => handleOutput(chunk, process.stdout))
    child.stderr.on('data', (chunk) => handleOutput(chunk, process.stderr))
    const fallbackTimer = setTimeout(() => {
      if (settled) {
        return
      }
      const hasFailureSummary = /\d+\s+failed/.test(output)
      const hasPassSummary = /\d+\s+passed/.test(output)
      settled = true
      stopProcess(child).finally(() => resolve(hasFailureSummary || !hasPassSummary ? 1 : 0))
    }, 45000)
    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(fallbackTimer)
        resolve(code ?? 1)
      }
    })
  })
}

function stopProcess(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve()
      return
    }

    child.once('exit', () => resolve())
    if (isWindows) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      setTimeout(resolve, 1000).unref()
      return
    }

    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL')
      }
    }, 5000).unref()
  })
}
