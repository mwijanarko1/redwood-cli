// Page HTML cache for authenticated GET fallbacks after sustained 503s.
// Never stores cookies. Callers must not cache login/auth pages.

import { readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export function isCacheablePath(path) {
  const p = String(path || '')
  return !/\/auth\b/i.test(p) && !/login/i.test(p)
}

export function cacheFileName(path) {
  return (
    String(path || '')
      .replace(/^\/+/, '')
      .replace(/[/\\]+/g, '_') + '.json'
  )
}

export function readCachedPage(cacheDir, path) {
  if (!isCacheablePath(path)) return null
  try {
    const data = JSON.parse(readFileSync(join(cacheDir, cacheFileName(path)), 'utf8'))
    if (typeof data?.html !== 'string' || typeof data?.fetchedAt !== 'number') return null
    if (data.html.includes('login to your account')) return null
    return { html: data.html, fetchedAt: data.fetchedAt }
  } catch {
    return null
  }
}

export function writeCachedPage(cacheDir, path, html, fetchedAt = Date.now()) {
  if (!isCacheablePath(path)) return
  if (typeof html !== 'string' || html.includes('login to your account')) return
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(cacheDir, 0o700)
  } catch {}
  const file = join(cacheDir, cacheFileName(path))
  writeFileSync(file, JSON.stringify({ fetchedAt, html }), { mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {}
}

export function clearPageCache(cacheDir) {
  try {
    rmSync(cacheDir, { recursive: true, force: true })
  } catch {}
}
