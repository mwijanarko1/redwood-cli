import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitize, decodeEntities, wrap, profileName, formatPage } from '../formatters.mjs'

test('sanitize strips terminal escapes', () => {
  assert.equal(sanitize('hi\x1bx'), 'hix')
  assert.ok(!sanitize('hi\x1b[31mx').includes('\x1b'))
  assert.equal(sanitize('a\tb\nc'), 'a\tb\nc')
})

test('decodeEntities', () => {
  assert.equal(decodeEntities('a&amp;b&lt;c&gt;'), 'a&b<c>')
  assert.equal(decodeEntities('it&#x27;s'), "it's")
})

test('wrap', () => {
  assert.equal(wrap('one two three', 7).join('|'), 'one two|three')
})

test('profileName', () => {
  assert.equal(profileName('<input placeholder="full name" value="Ada Lovelace"/>'), 'Ada Lovelace')
  assert.equal(profileName('<div/>'), '')
})

test('formatPage home smoke', () => {
  const out = formatPage('/batch1', '<span>3 days to demo day</span>')
  assert.match(out, /demo day/)
})
