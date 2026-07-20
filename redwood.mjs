#!/usr/bin/env node
// Interactive CLI for the Redwood Founders batch 1 board.
// Auth via Next.js server actions; pages are SSR HTML (no public REST API).

import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { createInterface, emitKeypressEvents } from 'node:readline'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { stdin, stdout } from 'node:process'

const BASE = 'https://redwoodfounders.org'
const STATE_DIR = join(homedir(), '.config', 'redwood-cli')
const STATE = join(STATE_DIR, 'session.json')

// Action IDs are build hashes — may need refreshing after a site deploy.
const ACTIONS = {
  login: { id: '4074a66ad1146c5a983d0911e50d4115a8c8ea495d', path: '/batch1/auth' },
  signup: { id: '4095a09900bef724e98604b54230c6532017b57122', path: '/batch1/auth/signup' },
  forgot: { id: '408b20acb073e3848d9d40c11b6801e00182f8c54f', path: '/batch1/auth/forgot-password' },
}

const MENU = [
  { label: 'home', path: '/batch1' },
  { label: 'welcome', path: '/batch1/welcome' },
  { label: 'activity', path: '/batch1/activity' },
  { label: 'people', path: '/batch1/people' },
  { label: 'mentors', path: '/batch1/mentors' },
  { label: 'credits', path: '/batch1/credits' },
  { label: 'profile', path: '/batch1/profile' },
  { label: 'demo day', path: '/batch1/demo-day' },
  { label: 'week 1', path: '/batch1/weeks/1' },
  { label: 'week 2', path: '/batch1/weeks/2' },
  { label: 'week 3', path: '/batch1/weeks/3' },
  { label: 'week 4', path: '/batch1/weeks/4' },
  { label: 'week 5', path: '/batch1/weeks/5' },
  { label: 'week 6', path: '/batch1/weeks/6' },
  { label: 'week 7', path: '/batch1/weeks/7' },
  { label: 'week 8', path: '/batch1/weeks/8' },
  { label: 'logout', action: 'logout' },
  { label: 'quit', action: 'quit' },
]

const PAGE_ALIASES = {
  home: '/batch1',
  batch1: '/batch1',
  welcome: '/batch1/welcome',
  credits: '/batch1/credits',
  activity: '/batch1/activity',
  people: '/batch1/people',
  mentors: '/batch1/mentors',
  profile: '/batch1/profile',
  'demo-day': '/batch1/demo-day',
  demoday: '/batch1/demo-day',
}

// ── session ──────────────────────────────────────────────────────────

function loadSession() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'))
  } catch {
    return { cookies: '' }
  }
}

function saveSession(s) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  try { chmodSync(STATE_DIR, 0o700) } catch {}
  writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 })
  try { chmodSync(STATE, 0o600) } catch {}
}

function clearSession() {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  try { chmodSync(STATE_DIR, 0o700) } catch {}
  writeFileSync(STATE, JSON.stringify({ cookies: '' }, null, 2), { mode: 0o600 })
  try { chmodSync(STATE, 0o600) } catch {}
}

function hasSession() {
  return Boolean(loadSession().cookies)
}

function parseSetCookie(res) {
  // requires Node 18.17+ (getSetCookie); see package.json engines
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const jar = {}
  for (const c of (loadSession().cookies || '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const i = c.indexOf('=')
    if (i > 0) jar[c.slice(0, i)] = c.slice(i + 1)
  }
  for (const raw of list) {
    const part = raw.split(';')[0]
    const i = part.indexOf('=')
    if (i <= 0) continue
    const name = part.slice(0, i)
    const value = part.slice(i + 1)
    const expired =
      !value ||
      /(?:^|;\s*)max-age=0(?:;|$)/i.test(raw) ||
      /expires=Thu, 01 Jan 1970/i.test(raw)
    if (expired) delete jar[name]
    else jar[name] = value
  }
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

// ── prompts ──────────────────────────────────────────────────────────

function ask(question) {
  const rl = createInterface({ input: stdin, output: stdout })
  return new Promise((resolve) => {
    rl.on('SIGINT', () => {
      rl.close()
      stdout.write('\n')
      process.exit(130)
    })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function askPassword(question = 'password: ') {
  if (!stdin.isTTY) return ask(question)
  return new Promise((resolve) => {
    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    emitKeypressEvents(stdin)
    let value = ''
    const onKey = (str, key) => {
      if (key?.ctrl && key.name === 'c') {
        stdin.setRawMode(false)
        stdin.off('keypress', onKey)
        stdout.write('\n')
        process.exit(130)
      }
      if (key?.name === 'return' || key?.name === 'enter') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('keypress', onKey)
        stdout.write('\n')
        resolve(value)
        return
      }
      if (key?.name === 'backspace') {
        if (value.length) value = value.slice(0, -1)
        return
      }
      if (str && str >= ' ') value += str
    }
    stdin.on('keypress', onKey)
  })
}

async function promptLogin() {
  console.log('\n  redwood batch 1\n')
  const email = await ask('  email: ')
  if (!email) throw new Error('please enter your email')
  const password = await askPassword('  password: ')
  if (!password) throw new Error('please enter your password')
  return { email, password }
}

// ── http ─────────────────────────────────────────────────────────────

async function serverAction(name, fields) {
  const { id, path } = ACTIONS[name]
  const body = new FormData()
  for (const [k, v] of Object.entries(fields)) body.append(`1_${k}`, String(v))
  body.append('0', '["$K1"]')

  const session = loadSession()
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      accept: 'text/x-component',
      'next-action': id,
      ...(session.cookies ? { cookie: session.cookies } : {}),
    },
    body,
    redirect: 'manual',
  })

  const cookies = parseSetCookie(res)
  if (cookies) saveSession({ ...session, cookies, at: new Date().toISOString() })

  const text = await res.text()
  const payloads = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\d+:(\{.*\})$/)
    if (m) {
      try {
        payloads.push(JSON.parse(m[1]))
      } catch {}
    }
  }
  return { status: res.status, payloads }
}

async function getPage(path) {
  const session = loadSession()
  if (!session.cookies) throw new Error('not logged in')
  const res = await fetch(BASE + path, {
    headers: { accept: 'text/html', cookie: session.cookies },
    redirect: 'manual',
  })
  const cookies = parseSetCookie(res)
  if (cookies) saveSession({ ...session, cookies })
  return {
    status: res.status,
    location: res.headers.get('location'),
    html: await res.text(),
  }
}

function ensureAuthed(r) {
  if (r.status >= 300 && r.status < 400 && (r.location || '').includes('auth')) {
    throw new Error('session expired')
  }
  if (r.html.includes('login to your account')) throw new Error('session expired')
}

// ── text helpers ─────────────────────────────────────────────────────

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<!--\s*-->/g, '')
}

function unwrapComments(s) {
  return decodeEntities(String(s).replace(/<!--\s*-->/g, '').replace(/\s+/g, ' ').trim())
}

function wrap(text, width = 72, indent = '') {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w
    if (next.length > width && cur) {
      lines.push(indent + cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(indent + cur)
  return lines
}

function stripHtml(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '\n'),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function cleanText(html) {
  const lines = stripHtml(html)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const skip = new Set([
    'home',
    'welcome',
    'sponsor',
    'collaborate',
    'get in touch',
    'redwood founders',
    'overview',
  ])
  const out = []
  let seenNav = 0
  for (const l of lines) {
    if (skip.has(l.toLowerCase()) && seenNav < 12) {
      seenNav++
      continue
    }
    // week number nav pills
    if (/^[1-8]$/.test(l) && seenNav < 20) {
      seenNav++
      continue
    }
    out.push(l)
  }
  return out.join('\n')
}

function isUrl(s) {
  return /^https?:\/\//i.test(s) || /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)
}

// ── page formatters ──────────────────────────────────────────────────

function formatHome(html) {
  const lines = []
  const demo = html.match(/>([^<]*days? to demo day)</i)
  if (demo) lines.push(unwrapComments(demo[1]))

  const nextIdx = html.indexOf('next up')
  if (nextIdx >= 0) {
    const slice = html.slice(nextIdx, nextIdx + 1200)
    const inner = slice.match(/>\s*(week\s*[\s\S]*?)\s*<\/span>/i)
    if (inner) {
      const t = unwrapComments(inner[1].replace(/<!--\s*-->/g, ' '))
        .replace(/\s+/g, ' ')
        .trim()
      if (t) lines.push(`next up · ${t}`)
    }
  }

  const dlLabel = html.match(
    /tracking-\[0\.1em\][^>]*uppercase">([^<]*deadline[^<]*)/i,
  )?.[1]
  const dlDays = html.match(/text-4xl[^"]*">(\d+)<\/span>/)?.[1]
  if (dlLabel && dlDays) lines.push(`${unwrapComments(dlLabel)} · ${dlDays} days left`)

  const theme = html.match(
    /this week[\s\S]{0,200}?href="\/batch1\/weeks\/(\d+)"[^>]*>([^<]+)</i,
  )
  if (theme) lines.push('', `this week · week ${theme[1]}`, `  ${unwrapComments(theme[2])}`)

  const taskRe =
    /(?:complete your profile|read the welcome page|add your week \d+ commitment|rsvp for the build weekend|check out the speaker[^<]*|set your commitment for the week|you've found your team)/gi
  const tasks = [...html.matchAll(taskRe)].map((m) => unwrapComments(m[0]))
  const uniq = [...new Set(tasks)]
  if (uniq.length) {
    lines.push('', 'to-do')
    for (const t of uniq) lines.push(`  · ${t}`)
  }

  return lines.join('\n').trim() || cleanText(html)
}

function formatWelcome(html) {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html
  // drop nav chrome
  const body = main
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
  const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) =>
    unwrapComments(m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')),
  )
  const lines = ['welcome', '']
  for (const p of paras) {
    if (!p || /whatsapp|luma|share on/i.test(p)) continue
    if (p.length < 80 && !p.includes('\n')) lines.push(p)
    else lines.push(...wrap(p.replace(/\n/g, ' '), 72), '')
  }
  const links = []
  for (const m of body.matchAll(/href="(https:\/\/[^"]+)"[^>]*title="([^"]+)"/g)) {
    links.push(`  ${m[2]}  ${m[1]}`)
  }
  for (const m of body.matchAll(/href="(https:\/\/(?:chat\.whatsapp|lu\.ma|luma)[^"]+)"/g)) {
    const url = m[1]
    if (!links.some((l) => l.includes(url))) {
      const label = /whatsapp/i.test(url) ? 'whatsapp' : /lu\.?ma/i.test(url) ? 'luma' : 'link'
      links.push(`  ${label}  ${url}`)
    }
  }
  if (links.length) {
    lines.push('links')
    lines.push(...links)
  }
  return lines.join('\n').trim()
}

function formatActivity(html) {
  const lines = []
  const stats = html.match(/(\d+)\s*committed[\s\S]{0,40}?(\d+)\s*shipped[\s\S]{0,40}?(\d+)\s*teams/i)
  if (stats) lines.push(`${stats[1]} committed · ${stats[2]} shipped · ${stats[3]} teams`, '')

  // split by week sections
  const sections = html.split(
    /<h2 class="text-xl font-black tracking-\[-0\.03em\] text-white lowercase">/i,
  )
  for (let i = 1; i < sections.length; i++) {
    const sec = sections[i]
    const head = sec.match(
      /week\s*(?:<!--\s*-->)?\s*(\d+)[\s\S]{0,20}?<\/h2>\s*<span[^>]*>([^<]*)<\/span>/i,
    )
    if (!head) continue
    const weekN = unwrapComments(head[1])
    const theme = unwrapComments(head[2])
    lines.push(`week ${weekN}${theme ? ` · ${theme}` : ''}`)

    // shipped block
    const shipBlock = sec.match(
      /uppercase">shipped<\/span>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i,
    )
    if (shipBlock) {
      lines.push('  shipped')
      for (const li of shipBlock[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
        const name = li[1].match(/font-bold text-white lowercase">([^<]+)/)?.[1]
        const note = li[1].match(/text-sm text-white\/50">([^<]+)/)?.[1]
        const href = li[1].match(/href="([^"]+)"/)?.[1]
        const linkText = li[1].match(/href="[^"]+"[^>]*>([^<]+)/)?.[1]
        if (!name) continue
        let extra = note ? unwrapComments(note) : ''
        const url = href && isUrl(href) ? href.replace(/^https?:\/\//, '') : ''
        const detail = url || (linkText && !isUrl(href) ? unwrapComments(linkText) : '')
        lines.push(`    ${unwrapComments(name)}${extra ? ` — ${extra}` : ''}`)
        if (detail) lines.push(`      ${detail}`)
      }
    }

    const commitBlock = sec.match(
      /uppercase">committed<\/span>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i,
    )
    if (commitBlock) {
      lines.push('  committed')
      for (const li of commitBlock[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
        const who = li[1].match(/alt="([^"]+)"/)?.[1] || li[1].match(/text-xs text-white\/45">([^<]+)/)?.[1]
        const text = li[1].match(/text-sm leading-snug text-white\/85">([^<]+)/)?.[1]
        if (!who && !text) continue
        lines.push(`    ${unwrapComments(who || '?')}`)
        if (text) lines.push(...wrap(unwrapComments(text), 66, '      '))
      }
    }
    lines.push('')
  }
  return lines.join('\n').trim() || cleanText(html)
}

function formatPeople(html) {
  const people = []
  const cardRe =
    /<h3 class="truncate text-xl leading-none font-black tracking-\[-0\.03em\] lowercase">([^<]+)<\/h3>([\s\S]*?)(?=<h3 class="truncate text-xl|$)/g
  let m
  while ((m = cardRe.exec(html))) {
    const name = decodeEntities(m[1]).trim()
    const body = m[2]
    const teamM = body.match(/on team\s*(?:<!--\s*-->)?\s*([^<]*)</i)
    const team = teamM ? decodeEntities(teamM[1]).trim() : ''
    const blurbM = body.match(
      /<p class="text-xs leading-relaxed text-\[#A11212\]\/80">([\s\S]*?)<\/p>/,
    )
    const blurb = blurbM
      ? decodeEntities(blurbM[1].replace(/<br\s*\/?>/gi, ' ')).replace(/\s+/g, ' ').trim()
      : ''
    const section = (label) => {
      const sm = body.match(
        new RegExp(label + '[\\s\\S]*?<div class="flex flex-wrap gap-1\\.5">([\\s\\S]*?)<\\/div>', 'i'),
      )
      if (!sm) return []
      return [...sm[1].matchAll(/bg-\[#A11212\] font-medium text-white">([^<]+)/g)].map((x) =>
        decodeEntities(x[1]).trim(),
      )
    }
    people.push({ name, team, blurb, skills: section('skills'), interests: section('interests') })
  }

  let mentor = ''
  const mentorBlock = html.match(
    /text-sm font-medium text-white">([^<]+)<\/p><p class="text-xs text-white\/40">your team/i,
  )
  if (mentorBlock) mentor = decodeEntities(mentorBlock[1]).trim()

  let myTeam = null
  const teamNameM = html.match(
    /manage your team[\s\S]*?<h2[^>]*>([^<]+)<\/h2>[\s\S]*?<span[^>]*uppercase">([^<]+)/i,
  )
  if (teamNameM) {
    const members = []
    const start = html.indexOf('manage your team')
    const end = html.indexOf('leave team', start)
    const block = html.slice(start, end > start ? end : start + 5000)
    for (const mm of block.matchAll(/text-sm text-white">([^<]+)/g)) {
      const n = decodeEntities(mm[1]).trim()
      if (n && n !== mentor && !members.includes(n)) members.push(n)
    }
    myTeam = {
      name: decodeEntities(teamNameM[1]).trim(),
      status: decodeEntities(teamNameM[2]).trim(),
      members,
      mentor,
    }
  }

  const lines = []
  if (myTeam) {
    lines.push(`your team · ${myTeam.name} (${myTeam.status})`)
    for (const mem of myTeam.members) lines.push(`  · ${mem}`)
    if (myTeam.mentor) lines.push(`mentor · ${myTeam.mentor}`)
    lines.push('')
  }
  lines.push(`${people.length} people`, '')
  for (const p of people) {
    lines.push(p.name)
    lines.push(`  team       ${p.team || '—'}`)
    if (p.blurb) {
      const wrapped = wrap(p.blurb, 70)
      wrapped.forEach((l, i) => lines.push(i === 0 ? `  blurb      ${l}` : `             ${l}`))
    }
    if (p.skills.length) lines.push(`  skills     ${p.skills.join(', ')}`)
    if (p.interests.length) lines.push(`  interests  ${p.interests.join(', ')}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

function formatMentors(html) {
  const lines = ['your mentor', '']
  const name =
    html.match(/your mentor[\s\S]{0,800}?<h2[^>]*>([^<]+)<\/h2>/i)?.[1] ||
    html.match(/alt="([^"]+)"[\s\S]{0,120}?<h2 class="text-3xl[^"]*">([^<]+)/i)?.[2]
  const blurb = html.match(/>(your dedicated mentor[^<]*)</i)?.[1]
  if (name) lines.push(unwrapComments(name))
  if (blurb) lines.push(`  ${unwrapComments(blurb)}`)
  const wa = html.match(/href="(https:\/\/wa\.me\/[^"]+)"/)?.[1]
  const li = html.match(/href="(https:\/\/(?:www\.)?linkedin\.com\/in\/[^"]+)"/)?.[1]
  const phone = html.match(/text \+44[\d\s]+/i)?.[0]?.replace(/^text\s+/i, '')
  if (wa) lines.push(`  whatsapp  ${wa}`)
  if (li) lines.push(`  linkedin  ${li}`)
  if (phone) lines.push(`  phone     ${phone.trim()}`)

  const widerIdx = html.search(/wider rf team/i)
  if (widerIdx >= 0) {
    lines.push('', 'wider rf team')
    const chunk = html.slice(widerIdx, widerIdx + 20000)
    const seen = new Set()
    for (const m of chunk.matchAll(
      /href="(https:\/\/(?:www\.)?linkedin\.com\/[^"]+)"[^>]*title="([^"]+)"/g,
    )) {
      const n = unwrapComments(m[2])
      if (!n || seen.has(n)) continue
      seen.add(n)
      lines.push(`  · ${n}`)
      lines.push(`    ${m[1]}`)
    }
    for (const m of chunk.matchAll(/alt="([^"]+)"/g)) {
      const n = unwrapComments(m[1])
      if (!n || seen.has(n) || /logo|redwood/i.test(n)) continue
      seen.add(n)
      lines.push(`  · ${n}`)
    }
  }
  return lines.join('\n').trim()
}

function formatCredits(html) {
  const lines = ['credits · exclusive perks for batch 1 founders', '']
  // pair img alt with following perk span
  const re =
    /<img alt="([^"]+)"[\s\S]{0,500}?<span class="text-\[10px\][^"]*">([^<]+)<\/span>/g
  const seen = new Set()
  let m
  while ((m = re.exec(html))) {
    const name = m[1].trim()
    const perk = unwrapComments(m[2])
    if (!name || name === 'Redwood Founders' || seen.has(name + perk)) continue
    seen.add(name + perk)
    lines.push(`  ${name.padEnd(22)} ${perk}`)
  }
  // notion special case (alt split across imgs)
  if (![...seen].some((s) => s.startsWith('Notion'))) {
    if (/notion/i.test(html) && /6 months free/i.test(html)) {
      lines.splice(2, 0, `  ${'Notion'.padEnd(22)} 6 months free`)
    }
  }
  return lines.join('\n').trim() || cleanText(html)
}

function formatProfile(html) {
  const lines = []
  const pct = html.match(/profile\s*(?:<!--\s*-->)?\s*(\d+)\s*(?:<!--\s*-->)?\s*% complete/i)
  if (pct) lines.push(`profile · ${pct[1]}% complete`, '')

  const name = html.match(
    /placeholder="full name"[^>]*value="([^"]*)"/i,
  )?.[1]
  const blurb = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i)?.[1]
  if (name) lines.push(`name       ${decodeEntities(name)}`)
  if (blurb) {
    const b = decodeEntities(blurb).trim()
    const parts = b.split('\n')
    parts.forEach((p, i) => lines.push(i === 0 ? `blurb      ${p}` : `           ${p}`))
  }

  const selected = [
    ...html.matchAll(
      /rounded-full bg-white px-3 py-1\.5 text-sm font-medium text-\[#A11212\][^>]*>([^<]+)/g,
    ),
  ].map((m) => decodeEntities(m[1]).trim())

  // partition by section order in page: skills, interests, looking for, idea status
  const skillsIdx = html.indexOf('>skills<')
  const interestsIdx = html.indexOf('>interests<')
  const lookingIdx = html.search(/>looking for</i)
  const ideaIdx = html.search(/>idea status</i)

  const inRange = (label, start, end) => {
    if (start < 0) return []
    const slice = html.slice(start, end > start ? end : start + 3000)
    return [
      ...slice.matchAll(
        /rounded-full bg-white px-3 py-1\.5 text-sm font-medium text-\[#A11212\][^>]*>([^<]+)/g,
      ),
    ].map((m) => decodeEntities(m[1]).trim())
  }

  const skills = inRange('skills', skillsIdx, interestsIdx)
  const interests = inRange('interests', interestsIdx, lookingIdx)
  const looking = inRange('looking', lookingIdx, ideaIdx)
  const idea = inRange('idea', ideaIdx, ideaIdx + 2000)

  if (skills.length) lines.push(`skills     ${skills.join(', ')}`)
  if (interests.length) lines.push(`interests  ${interests.join(', ')}`)
  if (looking.length) lines.push(`looking    ${looking.join(', ')}`)
  if (idea.length) lines.push(`idea       ${idea.join(', ')}`)
  if (!skills.length && !interests.length && selected.length) {
    lines.push(`selected   ${selected.join(', ')}`)
  }

  const linkVals = [...html.matchAll(/<input[^>]*value="([^"]*)"[^>]*>/g)].map((m) => m[1])
  // name is first; later inputs linkedin/calendar
  const nonName = linkVals.filter((v) => v && v !== name)
  if (nonName[0]) lines.push(`link       ${nonName[0]}`)
  if (nonName[1]) lines.push(`calendar   ${nonName[1]}`)

  return lines.join('\n').trim() || cleanText(html)
}

function formatDemoDay(html) {
  const lines = ['demo day']
  const date = html.match(/demo day<\/h1>\s*<span[^>]*>([^<]+)/i)?.[1]
  if (date) lines.push(unwrapComments(date))
  const rest = cleanText(html)
    .split('\n')
    .filter((l) => !/^demo day$/i.test(l) && !/^\d+$/.test(l) && l.toLowerCase() !== unwrapComments(date || '').toLowerCase())
  if (rest.length) {
    lines.push('')
    lines.push(...rest.slice(0, 40))
  } else {
    lines.push('', '(details coming soon)')
  }
  return lines.join('\n').trim()
}

function formatWeek(html) {
  const lines = []
  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]
  if (title) lines.push(unwrapComments(title))

  const date = html.match(/font-bold text-white\/90">([^<]+)<\/span>/)?.[1]
  const loc = html.match(/location ·\s*(?:<!--\s*-->)?\s*([^<]+)/i)?.[1]
  const time = html.match(/>(\d{1,2}:\d{2}am\s*-\s*\d{1,2}(?::\d{2})?(?:am|pm))</i)?.[1]
  const meta = [date, loc && `location · ${unwrapComments(loc)}`, time]
    .filter(Boolean)
    .map(unwrapComments)
  if (meta.length) lines.push(meta.join(' · '))

  const cal = html.match(/href="(\/api\/batch1\/calendar[^"]*)"/i)?.[1]
  const luma = html.match(/href="(https:\/\/(?:lu\.ma|luma)[^"]+)"/i)?.[1]
  const maps = html.match(/href="(https:\/\/maps\.app\.goo\.gl\/[^"]+)"/i)?.[1]
  if (cal || luma || maps) {
    lines.push('')
    if (cal) lines.push(`  calendar  ${BASE}${cal}`)
    if (luma) lines.push(`  rsvp      ${luma}`)
    if (maps) lines.push(`  maps      ${maps}`)
  }

  const spIdx = html.search(/\/images\/speakers\//)
  if (spIdx >= 0) {
    // wider window so talk time near the speaker card is included
    const chunk = html.slice(Math.max(0, spIdx - 800), spIdx + 3500)
    const spName = chunk.match(/font-black[^>]*>([^<]+)</)?.[1]
    const spLi = chunk.match(/href="(https:\/\/(?:www\.)?linkedin\.com\/[^"]+)"/)?.[1]
    const spTalk = chunk.match(/text-base tracking[^>]*text-white\/70">([^<]+)/)?.[1]
    const spBio = chunk.match(/text-sm leading-relaxed text-white\/50">([^<]+)/)?.[1]
    const spWhen = chunk.match(/>(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[^<]{0,40}<\/span>/)?.[0]
    lines.push('', 'speaker')
    if (spName) lines.push(`  ${unwrapComments(spName)}`)
    if (spTalk) lines.push(`  ${unwrapComments(spTalk)}`)
    if (spWhen) {
      const t = unwrapComments(spWhen.replace(/<[^>]+>/g, '')).replace(/^>/,'')
      if (t) lines.push(`  when      ${t}`)
    }
    if (spBio) lines.push(...wrap(unwrapComments(spBio), 70, '  '))
    if (spLi) lines.push(`  linkedin  ${spLi}`)
  }

  const recapIdx = html.search(/recap · earlier talks/i)
  if (recapIdx >= 0) {
    lines.push('', 'recap · earlier talks')
    const chunk = html.slice(recapIdx, recapIdx + 5000)
    for (const m of chunk.matchAll(
      /font-bold[^>]*>([A-Za-z][^<]{1,40})<\/a>[\s\S]{0,120}?week\s*(?:<!--\s*-->)?\s*(\d+)/g,
    )) {
      lines.push(`  · ${unwrapComments(m[1])} · week ${unwrapComments(m[2])}`)
    }
    const notes = [
      ...new Set(
        [...chunk.matchAll(/href="(https:\/\/notes\.granola\.ai[^"?]+)/g)].map((m) => m[1]),
      ),
    ]
    for (const n of notes) lines.push(`  notes     ${n}`)
  }

  if (/uppercase">shipped</i.test(html) || /uppercase">committed</i.test(html)) {
    const act = formatActivity(html)
    if (act) lines.push('', act)
  }

  return lines.join('\n').trim() || cleanText(html)
}

function formatPage(path, html) {
  if (path === '/batch1' || path.endsWith('/batch1')) return formatHome(html)
  if (path.includes('/welcome')) return formatWelcome(html)
  if (path.includes('/activity')) return formatActivity(html)
  if (path.includes('/people')) return formatPeople(html)
  if (path.includes('/mentors')) return formatMentors(html)
  if (path.includes('/credits')) return formatCredits(html)
  if (path.includes('/profile')) return formatProfile(html)
  if (path.includes('/demo-day')) return formatDemoDay(html)
  if (path.includes('/weeks/')) return formatWeek(html)
  return cleanText(html)
}

// ── tui ──────────────────────────────────────────────────────────────

function clearScreen() {
  stdout.write('\x1b[2J\x1b[H')
}
function hideCursor() {
  stdout.write('\x1b[?25l')
}
function showCursor() {
  stdout.write('\x1b[?25h')
}

function pick(title, items, start = 0) {
  if (!stdin.isTTY) {
    console.log('  non-interactive: use `redwood <page>` (see --help)')
    return null
  }
  return new Promise((resolve) => {
    let idx = Math.max(0, Math.min(start, items.length - 1))
    let rows = 0
    const draw = () => {
      if (rows > 0) stdout.write(`\x1b[${rows}A`)
      const lines = [`  ${title}`, '']
      for (let i = 0; i < items.length; i++) {
        const cur = i === idx
        lines.push(`  ${cur ? '›' : ' '} ${cur ? `\x1b[1m${items[i].label}\x1b[0m` : items[i].label}`)
      }
      lines.push('', '  ↑/↓/k/j move  ·  enter open  ·  q quit')
      const out = lines.map((l) => l + '\x1b[K').join('\n') + '\n'
      stdout.write(out)
      rows = lines.length // not out.split — trailing \n would overcount by 1
    }
    hideCursor()
    draw()
    stdin.setRawMode(true)
    stdin.resume()
    emitKeypressEvents(stdin)
    const done = (value) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('keypress', onKey)
      showCursor()
      resolve(value)
    }
    const onKey = (_str, key) => {
      if (!key) return
      if ((key.ctrl && key.name === 'c') || key.name === 'escape' || key.name === 'q') return done(null)
      if (key.name === 'up' || key.name === 'k') {
        idx = (idx - 1 + items.length) % items.length
        return draw()
      }
      if (key.name === 'down' || key.name === 'j') {
        idx = (idx + 1) % items.length
        return draw()
      }
      if (key.name === 'return' || key.name === 'enter') done(items[idx])
    }
    stdin.on('keypress', onKey)
  })
}

async function showPage(item) {
  clearScreen()
  console.log(`\n  ${item.label}\n  ${'─'.repeat(Math.max(8, item.label.length))}\n`)
  process.stdout.write('  loading…')
  try {
    const r = await getPage(item.path)
    ensureAuthed(r)
    const text = formatPage(item.path, r.html)
    stdout.write('\r\x1b[K')
    console.log(text.split('\n').map((l) => '  ' + l).join('\n'))
  } catch (e) {
    stdout.write('\r\x1b[K')
    console.log('  ' + (e.message || e))
    if (String(e.message).includes('expired') || String(e.message).includes('not logged')) {
      clearSession()
      return 'relogin'
    }
  }
  console.log('\n  ─')
  if (!stdin.isTTY) return 'back'
  return new Promise((resolve) => {
    stdout.write('  enter back to menu  ·  q quit')
    stdin.setRawMode(true)
    stdin.resume()
    emitKeypressEvents(stdin)
    const onKey = (_str, key) => {
      if (!key) return
      if ((key.ctrl && key.name === 'c') || key.name === 'q' || key.name === 'escape') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('keypress', onKey)
        resolve('quit')
        return
      }
      if (key.name === 'return' || key.name === 'enter' || key.name === 'backspace') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('keypress', onKey)
        resolve('back')
      }
    }
    stdin.on('keypress', onKey)
  })
}

async function doLogin(email) {
  // never accept password as a CLI arg (shell history)
  let password
  if (!email) {
    ;({ email, password } = await promptLogin())
  } else {
    password = await askPassword('  password: ')
    if (!password) throw new Error('please enter your password')
  }
  stdout.write('\n  signing in…')
  const r = await serverAction('login', { email, password })
  stdout.write('\r\x1b[K')
  const err = r.payloads.find((p) => p.error)
  if (err) throw new Error(String(err.error).toLowerCase())
  if (!hasSession()) {
    throw new Error(
      'login failed — server action id may be stale (see README: refreshing server action IDs)',
    )
  }
  let who = ''
  try {
    const home = await getPage('/batch1')
    ensureAuthed(home)
    try {
      const prof = await getPage('/batch1/profile')
      who = formatProfile(prof.html).match(/^name\s+(.+)$/m)?.[1] || ''
    } catch {}
    if (!who) who = formatHome(home.html).split('\n')[0] || ''
  } catch {}
  console.log(who ? `\n  welcome, ${who}\n` : '\n  logged in\n')
  return who
}

async function menuLoop(startIdx = 0) {
  let idx = startIdx
  for (;;) {
    if (!hasSession()) await doLogin()
    clearScreen()
    console.log('')
    const choice = await pick('redwood batch 1', MENU, idx)
    if (!choice) {
      clearScreen()
      console.log('  bye\n')
      return
    }
    idx = MENU.indexOf(choice)
    if (choice.action === 'quit') {
      clearScreen()
      console.log('  bye\n')
      return
    }
    if (choice.action === 'logout') {
      clearSession()
      clearScreen()
      console.log('\n  logged out\n')
      await doLogin()
      idx = 0
      continue
    }
    const next = await showPage(choice)
    if (next === 'quit') {
      clearScreen()
      console.log('  bye\n')
      return
    }
    if (next === 'relogin') {
      await doLogin()
      idx = 0
    }
  }
}

function usage() {
  console.log(`redwood — Redwood Founders batch 1 board

Usage:
  redwood                 interactive menu (logs in if needed)
  redwood login           sign in, then open the menu
  redwood logout          clear saved session
  redwood <page>          print one page
  redwood week <1-8>      print a week page

Pages:
  home  welcome  activity  people  mentors
  credits  profile  demo-day

Menu keys:  ↑/↓/k/j  enter  q

Session file: ${STATE}
Requires Node.js 18.17+ (built-in fetch + getSetCookie).
`)
}

// ── main ─────────────────────────────────────────────────────────────

let values, positionals
try {
  ;({ values, positionals } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' } },
  }))
} catch (e) {
  console.error(String(e.message || e))
  usage()
  process.exit(1)
}

const [cmd, a] = positionals

try {
  if (values.help) {
    usage()
    process.exit(0)
  }

  if (!cmd) {
    if (!hasSession()) await doLogin()
    else {
      clearScreen()
      try {
        const home = await getPage('/batch1')
        ensureAuthed(home)
        let who = ''
        try {
          const prof = await getPage('/batch1/profile')
          who = formatProfile(prof.html).match(/^name\s+(.+)$/m)?.[1] || ''
        } catch {}
        if (who) console.log(`\n  hi ${who}`)
      } catch {
        clearSession()
        await doLogin()
      }
    }
    await menuLoop()
    process.exit(0)
  }

  if (cmd === 'login') {
    await doLogin(a) // email optional; password always prompted
    await menuLoop()
    process.exit(0)
  }

  if (cmd === 'logout') {
    clearSession()
    console.log('logged out')
    process.exit(0)
  }

  if (cmd === 'week') {
    const n = Number(a)
    if (!n || n < 1 || n > 8) {
      console.error('usage: redwood week <1-8>')
      process.exit(1)
    }
    if (!hasSession()) await doLogin()
    const path = `/batch1/weeks/${n}`
    const r = await getPage(path)
    ensureAuthed(r)
    console.log(formatPage(path, r.html))
    process.exit(0)
  }

  if (PAGE_ALIASES[cmd]) {
    if (!hasSession()) await doLogin()
    const path = PAGE_ALIASES[cmd]
    const r = await getPage(path)
    ensureAuthed(r)
    console.log(formatPage(path, r.html))
    process.exit(0)
  }

  console.error('unknown:', cmd)
  usage()
  process.exit(1)
} catch (e) {
  showCursor()
  if (stdin.isTTY) {
    try {
      stdin.setRawMode(false)
    } catch {}
  }
  console.error('\n  ' + String(e.message || e) + '\n')
  process.exit(1)
}
