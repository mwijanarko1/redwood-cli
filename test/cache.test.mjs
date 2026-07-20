import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isCacheablePath,
  cacheFileName,
  readCachedPage,
  writeCachedPage,
  clearPageCache,
} from '../cache.mjs'

test('isCacheablePath rejects auth/login routes', () => {
  assert.equal(isCacheablePath('/batch1/people'), true)
  assert.equal(isCacheablePath('/batch1/auth'), false)
  assert.equal(isCacheablePath('/batch1/login'), false)
})

test('write/read roundtrip stores fetchedAt and html', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-cache-'))
  const fetchedAt = 1_700_000_000_000
  writeCachedPage(dir, '/batch1/people', '<html>people</html>', fetchedAt)
  assert.deepEqual(readCachedPage(dir, '/batch1/people'), {
    html: '<html>people</html>',
    fetchedAt,
  })
})

test('cache files are 0600 and never store cookies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-cache-'))
  writeCachedPage(dir, '/batch1/home', '<p>ok</p>', 42)
  const file = join(dir, cacheFileName('/batch1/home'))
  const mode = statSync(file).mode & 0o777
  assert.equal(mode, 0o600)
  const raw = JSON.stringify(readCachedPage(dir, '/batch1/home'))
  assert.equal(raw.includes('cookie'), false)
  assert.equal(raw.includes('sb-'), false)
})

test('never caches login HTML or auth paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-cache-'))
  writeCachedPage(dir, '/batch1/auth', '<html>nope</html>', 1)
  assert.equal(readCachedPage(dir, '/batch1/auth'), null)
  writeCachedPage(dir, '/batch1/people', '<div>login to your account</div>', 1)
  assert.equal(existsSync(join(dir, cacheFileName('/batch1/people'))), false)
  assert.equal(readCachedPage(dir, '/batch1/people'), null)
})

test('clearPageCache removes private cached pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-cache-'))
  writeCachedPage(dir, '/batch1/profile', '<p>me</p>', 9)
  assert.ok(readCachedPage(dir, '/batch1/profile'))
  clearPageCache(dir)
  assert.equal(existsSync(dir), false)
  assert.equal(readCachedPage(dir, '/batch1/profile'), null)
})

test('corrupt or login-shaped cache entries are ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-cache-'))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, cacheFileName('/batch1/credits'))
  writeFileSync(file, '{"html":"login to your account","fetchedAt":1}', { mode: 0o600 })
  assert.equal(readCachedPage(dir, '/batch1/credits'), null)
  writeFileSync(file, '{"nope":true}', { mode: 0o600 })
  assert.equal(readCachedPage(dir, '/batch1/credits'), null)
})
