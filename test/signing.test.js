import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { refresh } from '../.github/scripts/refresh-update-yml.mjs'

test('latest.yml follows the signed installer: new checksum and size, other files untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-sign-'))
  const signed = Buffer.from('signed installer bytes')
  fs.writeFileSync(path.join(dir, 'Dodobox-Setup-1.0.0-x64.exe'), signed)
  fs.writeFileSync(path.join(dir, 'latest.yml'), `version: 1.0.0
files:
  - url: Dodobox-Setup-1.0.0-x64.exe
    sha512: OLDSUM==
    size: 5
  - url: Missing.exe
    sha512: KEEP==
    size: 7
path: Dodobox-Setup-1.0.0-x64.exe
sha512: OLDSUM==
releaseDate: '2026-10-15T00:00:00.000Z'
`)
  refresh(dir)
  const sum = crypto.createHash('sha512').update(signed).digest('base64')
  const text = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8')
  assert.ok(text.includes(`    sha512: ${sum}\n    size: ${signed.length}\n`))
  assert.ok(text.includes(`path: Dodobox-Setup-1.0.0-x64.exe\nsha512: ${sum}\n`))
  assert.ok(text.includes('sha512: KEEP==\n    size: 7'), 'entries without a file are left alone')
  assert.ok(text.includes("releaseDate: '2026-10-15T00:00:00.000Z'"))
  fs.rmSync(dir, { recursive: true, force: true })
})
