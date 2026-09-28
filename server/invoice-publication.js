import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDir } from './config.js'

const journalDir = path.join(dataDir, 'invoice-publications')

function remove(file) {
  try { fs.unlinkSync(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

export function preparePublication(targets, temporary, oldTargets) {
  fs.mkdirSync(journalDir, { recursive: true })
  const id = randomUUID()
  const directory = path.join(journalDir, id)
  const entries = ['excel', 'pdf'].map((kind) => {
    const target = targets[kind].absolutePath
    const exists = fs.existsSync(target)
    if (exists && !fs.statSync(target).isFile()) throw new Error('Invoice output path is not a file.')
    return { target, temporary: temporary[kind], backup: path.join(directory, kind), exists }
  })
  fs.mkdirSync(directory)
  for (const entry of entries) {
    if (entry.exists) fs.copyFileSync(entry.target, entry.backup)
  }
  const obsolete = oldTargets ? ['excel', 'pdf'].map((kind) => oldTargets[kind].absolutePath)
    .filter((file) => !entries.some((entry) => entry.target === file)) : []
  const journal = { id, directory, entries, obsolete }
  fs.writeFileSync(path.join(directory, 'manifest.pending'), JSON.stringify(journal), { flush: true })
  fs.renameSync(path.join(directory, 'manifest.pending'), path.join(directory, 'manifest.json'))
  return journal
}

export function publishFiles(journal, db) {
  for (const entry of journal.entries) fs.renameSync(entry.temporary, entry.target)
  db.prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)')
    .run(`publication:${journal.id}`, 'committed')
}

export function finishPublication(journal, db) {
  const key = `publication:${journal.id}`
  const committed = db.prepare('SELECT 1 FROM app_settings WHERE setting_key = ?').get(key)
  if (committed) {
    for (const file of journal.obsolete) remove(file)
  } else {
    for (const entry of journal.entries) {
      if (entry.exists) fs.copyFileSync(entry.backup, entry.target)
      else remove(entry.target)
    }
  }
  for (const entry of journal.entries) remove(entry.temporary)
  // Delete the manifest before its backups; recovery is repeatable until this point.
  remove(path.join(journal.directory, 'manifest.json'))
  for (const entry of journal.entries) remove(entry.backup)
  fs.rmdirSync(journal.directory)
  db.prepare('DELETE FROM app_settings WHERE setting_key = ?').run(key)
}

export function recoverPublications(db) {
  fs.mkdirSync(journalDir, { recursive: true })
  for (const entry of fs.readdirSync(journalDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = path.join(journalDir, entry.name, 'manifest.json')
    if (fs.existsSync(manifest)) finishPublication(JSON.parse(fs.readFileSync(manifest, 'utf8')), db)
  }
}
