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

test('formatActivity blank line between consecutive entries', () => {
  const html = `
    <h2 class="text-xl font-black tracking-[-0.03em] text-white lowercase">week 1</h2>
    <span>build</span>
    <span class="uppercase">shipped</span>
    <ul>
      <li>
        <span class="font-bold text-white lowercase">acme</span>
        <span class="text-sm text-white/50">note a</span>
      </li>
      <li>
        <span class="font-bold text-white lowercase">beta</span>
        <span class="text-sm text-white/50">note b</span>
      </li>
    </ul>
    <span class="uppercase">committed</span>
    <ul>
      <li>
        <img alt="ada" />
        <span class="text-sm leading-snug text-white/85">ship X</span>
      </li>
      <li>
        <img alt="bob" />
        <span class="text-sm leading-snug text-white/85">ship Y</span>
      </li>
    </ul>
  `
  const lines = formatPage('/batch1/activity', html).split('\n')
  const shipIdx = lines.indexOf('  shipped')
  const commitIdx = lines.indexOf('  committed')
  assert.ok(shipIdx >= 0 && commitIdx > shipIdx)
  // no blank immediately after heading; exactly one blank between the two entries
  assert.notEqual(lines[shipIdx + 1], '')
  assert.match(lines[shipIdx + 1], /acme/)
  assert.equal(lines[shipIdx + 2], '')
  assert.match(lines[shipIdx + 3], /beta/)
  assert.notEqual(lines[commitIdx + 1], '')
  assert.equal(lines[commitIdx + 1], '    ada')
  assert.equal(lines[commitIdx + 2], '      ship X')
  assert.equal(lines[commitIdx + 3], '')
  assert.equal(lines[commitIdx + 4], '    bob')
})

test('formatActivity wraps shipped summary and non-URL detail', () => {
  const longNote =
    'shipped a very long product update that should wrap across the terminal width instead of running off'
  const longDetail =
    'release notes covering many words so the detail line wraps under the indent without exceeding seventy two columns'
  const html = `
    <h2 class="text-xl font-black tracking-[-0.03em] text-white lowercase">week 1</h2>
    <span>build</span>
    <span class="uppercase">shipped</span>
    <ul>
      <li>
        <span class="font-bold text-white lowercase">acme</span>
        <span class="text-sm text-white/50">${longNote}</span>
        <a href="https://example.com/very/long/path/that/should/stay/on/one/line/because-urls-must-not-split">example.com/link</a>
      </li>
      <li>
        <span class="font-bold text-white lowercase">beta</span>
        <span class="text-sm text-white/50">short note</span>
        <a href="/internal">${longDetail}</a>
      </li>
    </ul>
  `
  const out = formatPage('/batch1/activity', html)
  const lines = out.split('\n')
  const nonUrl = lines.filter((l) => !/example\.com\//.test(l))
  for (const l of nonUrl) {
    assert.ok(l.length <= 72, `line too wide (${l.length}): ${l}`)
  }
  assert.ok(lines.some((l) => /example\.com\/very\/long\/path/.test(l)))
  assert.ok(lines.some((l) => l.startsWith('      ') && /release notes/.test(l)))
})

test('formatPeople blurb lines stay around 72 columns', () => {
  const blurb =
    'Building a marketplace for founders who need concise terminal clients and readable blurbs that never spill past the usual seventy two column width'
  const html = `
    <h3 class="truncate text-xl leading-none font-black tracking-[-0.03em] lowercase">ada</h3>
    <p>on team <!-- -->alpha</p>
    <p class="text-xs leading-relaxed text-[#A11212]/80">${blurb}</p>
  `
  const out = formatPage('/batch1/people', html)
  const blurbLines = out.split('\n').filter((l) => /blurb|^ {13}/.test(l))
  assert.ok(blurbLines.length >= 2, 'expected wrapped blurb')
  for (const l of blurbLines) {
    assert.ok(l.length <= 72, `blurb line too wide (${l.length}): ${l}`)
  }
})

test('formatWelcome wraps prose above 72 columns', () => {
  // 78 chars — previously left unwrapped by the <80 short-paragraph threshold
  const prose =
    'Welcome aboard, founders who ship fast and read every terminal line carefully.'
  assert.equal(prose.length, 78)
  const url = 'https://example.com/very/long/path/that/must/stay/on/one/line/without-wrapping'
  const html = `<main><p>${prose}</p><p>${url}</p></main>`
  const out = formatPage('/batch1/welcome', html)
  const lines = out.split('\n')
  const proseLines = lines.filter((l) => /Welcome aboard|terminal line|carefully/.test(l))
  assert.ok(proseLines.length >= 2, 'expected wrapped welcome prose')
  for (const l of proseLines) {
    assert.ok(l.length <= 72, `prose line too wide (${l.length}): ${l}`)
  }
  assert.ok(lines.includes(url), 'URL should stay on one line')
})
