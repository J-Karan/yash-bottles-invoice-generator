import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { describe, it } from 'node:test'

const traverse = traverseModule.default
const srcDir = path.dirname(fileURLToPath(import.meta.url))
const allowedBrowserGlobals = new Set([
  'Array',
  'Boolean',
  'Date',
  'Error',
  'Intl',
  'JSON',
  'Map',
  'Math',
  'Number',
  'Object',
  'Promise',
  'Set',
  'String',
  'URL',
  'URLSearchParams',
  'console',
  'document',
  'encodeURIComponent',
  'fetch',
  'globalThis',
  'localStorage',
  'window',
])

function listSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath)
    }
    return /\.(jsx|js)$/.test(entry.name) ? [fullPath] : []
  })
}

function findUnresolvedReferences(filePath) {
  const code = fs.readFileSync(filePath, 'utf8')
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'importMeta'],
    errorRecovery: true,
  })
  const missing = new Map()

  traverse(ast, {
    ReferencedIdentifier(referencePath) {
      const name = referencePath.node.name
      if (allowedBrowserGlobals.has(name) || referencePath.scope.hasBinding(name)) {
        return
      }

      const location = referencePath.node.loc?.start
      const locations = missing.get(name) || []
      locations.push(location ? `${location.line}:${location.column + 1}` : 'unknown')
      missing.set(name, locations)
    },
  })

  return missing
}

describe('frontend static references', () => {
  it('does not reference moved helpers without importing them', () => {
    const failures = []

    for (const filePath of listSourceFiles(srcDir)) {
      const missing = findUnresolvedReferences(filePath)
      for (const [name, locations] of missing) {
        failures.push(`${path.relative(srcDir, filePath)} -> ${name} at ${locations.join(', ')}`)
      }
    }

    assert.deepEqual(failures, [])
  })
})
