#!/usr/bin/env node
// Interactive CLI for the Redwood Founders batch 1 board.
// Auth via Next.js server actions; pages are SSR HTML (no public REST API).

import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync, mkdirSync, chmodSync, accessSync, constants } from 'node:fs'
import { createInterface, emitKeypressEvents } from 'node:readline'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { stdin, stdout } from 'node:process'
import { formatPage, profileName } from './formatters.mjs'
import {
  WRITE_ACTIONS,
  LOOKING_FOR,
  IDEA_STATUS,
  CLEAR,
  extractProfileState,
  extractPeopleState,
  resolveExactName,
  parseActionResult,
  mergeProfile,
  parseCsv,
  normalizeLookingFor,
  normalizeIdeaStatus,
  normalizeTeamStatus,
  normalizeProfilePayload,
  applyPromptValue,
  confirmMode,
  mimeFromPath,
} from './writes.mjs'

const BASE = 'https://redwoodfounders.org'
const STATE_DIR = join(homedir(), '.config', 'redwood-cli')
const STATE = join(STATE_DIR, 'session.json')
const AUTH_COOKIE_RE = /sb-[\w-]+-auth-token=/

// Action IDs are build hashes — may need refreshing after a site deploy.
const ACTIONS = {
  login: { id: '4074a66ad1146c5a983d0911e50d4115a8c8ea495d', path: '/batch1/auth' },
  ...WRITE_ACTIONS,
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
  ...Array.from({ length: 8 }, (_, i) => ({
    label: `week ${i + 1}`,
    path: `/batch1/weeks/${i + 1}`,
  })),
  { label: 'write…', action: 'write' },
  { label: 'logout', action: 'logout' },
  { label: 'quit', action: 'quit' },
]

const WRITE_MENU = [
  { label: 'commitment', action: 'commitment' },
  { label: 'ship', action: 'ship' },
  { label: 'profile edit', action: 'profile-edit' },
  { label: 'team…', action: 'team' },
  { label: 'back', action: 'back' },
]

const TEAM_WRITE_MENU = [
  { label: 'create team', action: 'team-create' },
  { label: 'update team', action: 'team-update' },
  { label: 'invite member', action: 'team-invite' },
  { label: 'respond to invite', action: 'team-respond' },
  { label: 'leave team', action: 'team-leave' },
  { label: 'remove member', action: 'team-remove' },
  { label: 'transfer ownership', action: 'team-transfer' },
  { label: 'disband team', action: 'team-disband' },
  { label: 'back', action: 'back' },
]

// one route table: derive one-shot aliases from MENU
const PAGE_ALIASES = Object.fromEntries(
  MENU.filter((m) => m.path).flatMap((m) => {
    const key = m.label.replace(/\s+/g, '-')
    const aliases = [[key, m.path]]
    if (key === 'demo-day') aliases.push(['demoday', m.path])
    if (key === 'home') aliases.push(['batch1', m.path])
    return aliases
  }),
)

class AuthError extends Error {
  constructor(message = 'session expired') {
    super(message)
    this.name = 'AuthError'
  }
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
  try {
    chmodSync(STATE_DIR, 0o700)
  } catch {}
  writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 })
  try {
    chmodSync(STATE, 0o600)
  } catch {}
}

function clearSession() {
  saveSession({ cookies: '' })
}

function hasSession() {
  return AUTH_COOKIE_RE.test(loadSession().cookies || '')
}

function parseSetCookie(res, existing = '') {
  // requires Node 18.17+ (getSetCookie); see package.json engines
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const jar = {}
  for (const c of (existing || '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const i = c.indexOf('=')
    if (i > 0) jar[c.slice(0, i)] = c.slice(i + 1)
  }
  for (const raw of list) {
    const part = raw.split(';')[0]
    const i = part.indexOf('=')
    if (i <= 0) continue
    const name = part.slice(0, i)
    const value = part.slice(i + 1)
    const maxAge = raw.match(/(?:^|;\s*)max-age\s*=\s*(-?\d+)/i)
    const exp = raw.match(/(?:^|;\s*)expires\s*=\s*([^;]+)/i)
    const expired =
      !value ||
      (maxAge && Number(maxAge[1]) <= 0) ||
      (exp && !Number.isNaN(Date.parse(exp[1])) && Date.parse(exp[1]) <= Date.now())
    if (expired) delete jar[name]
    else jar[name] = value
  }
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

// ── prompts / keys ───────────────────────────────────────────────────

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

/** Own raw-mode setup/teardown. onKey(str, key, done) — call done(value) to finish. */
function readKeys(onKey) {
  return new Promise((resolve) => {
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    emitKeypressEvents(stdin)
    const done = (value) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('keypress', handler)
      resolve(value)
    }
    const handler = (str, key) => onKey(str, key, done)
    stdin.on('keypress', handler)
  })
}

function askPassword(question = 'password: ') {
  if (!stdin.isTTY) return ask(question)
  stdout.write(question)
  let value = ''
  return readKeys((str, key, done) => {
    if (key?.ctrl && key.name === 'c') {
      stdout.write('\n')
      process.exit(130)
    }
    if (key?.name === 'return' || key?.name === 'enter') {
      stdout.write('\n')
      done(value)
      return
    }
    if (key?.name === 'backspace') {
      if (value.length) value = value.slice(0, -1)
      return
    }
    if (str && str >= ' ') value += str
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

  const cookies = parseSetCookie(res, session.cookies)
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
  return { status: res.status, payloads, cookies }
}

/** JSON-body Next.js server actions (board writes). */
async function jsonAction(name, args, pathOverride) {
  const action = ACTIONS[name]
  if (!action) throw new Error(`unknown action: ${name}`)
  const path = pathOverride || action.path
  if (!path) throw new Error(`path required for action: ${name}`)

  const session = loadSession()
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      accept: 'text/x-component',
      'content-type': 'text/plain;charset=UTF-8',
      'next-action': action.id,
      ...(session.cookies ? { cookie: session.cookies } : {}),
    },
    body: JSON.stringify(args),
    redirect: 'manual',
  })

  const cookies = parseSetCookie(res, session.cookies)
  if (cookies) saveSession({ ...session, cookies, at: new Date().toISOString() })

  const text = await res.text()
  const result = parseActionResult(text, res.status)
  if (!result.ok) throw new Error(result.error || 'action failed')
  return { status: res.status, payloads: result.payloads, cookies, text }
}

async function confirmWrite(summary, yes) {
  const mode = confirmMode({ yes: !!yes, isTTY: stdin.isTTY })
  if (mode === 'yes') return true
  if (mode === 'need-flag') {
    throw new Error('refusing to write without --yes (non-interactive). Re-run with --yes to confirm.')
  }
  console.log(`\n  ${summary}`)
  const ans = await ask('  proceed? [y/N] ')
  return /^(y|yes)$/i.test(ans)
}

async function loadPeopleState() {
  const r = await getPage('/batch1/people')
  ensureAuthed(r)
  return extractPeopleState(r.html)
}

async function loadProfileState() {
  const r = await getPage('/batch1/profile')
  ensureAuthed(r)
  return extractProfileState(r.html)
}

function requireTeam(state, { owner = false } = {}) {
  if (!state.myTeam) throw new Error('you are not on a team')
  if (owner && state.myTeam.role !== 'owner') throw new Error('owner access required')
  return state.myTeam
}

function requireAdmin(state) {
  if (!state.isAdmin) throw new Error('admin access required')
}

function weekPath(n) {
  return `/batch1/weeks/${n}`
}

function parseWeek(n) {
  const w = Number(n)
  if (!w || w < 1 || w > 8) throw new Error('week must be 1-8')
  return w
}

async function cmdCommitment(weekArg, text, yes) {
  const week = parseWeek(weekArg)
  const body = String(text || '').trim()
  if (!body) throw new Error('usage: redwood commitment <1-8> <text> [--yes]')
  await ensureLogin()
  if (!(await confirmWrite(`set week ${week} commitment to:\n  ${body}`, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('setIntention', [week, body], weekPath(week))
  console.log(`  ok · week ${week} commitment saved`)
}

async function cmdShip(weekArg, url, note, yes) {
  const week = parseWeek(weekArg)
  const link = String(url || '').trim()
  if (!link) throw new Error('usage: redwood ship <1-8> <url> [note] [--yes]')
  await ensureLogin()
  const noteText = note == null ? '' : String(note)
  const summary = `set week ${week} ship:\n  url   ${link}${noteText ? `\n  note  ${noteText}` : ''}`
  if (!(await confirmWrite(summary, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('setShip', [week, link, noteText], weekPath(week))
  console.log(`  ok · week ${week} ship saved`)
}

async function uploadAvatar(filePath) {
  const bytes = readFileSync(filePath)
  const mime = mimeFromPath(filePath)
  const up = await jsonAction('getAvatarUploadUrl', [mime])
  const payload = up.payloads.find((p) => p && p.uploadUrl && p.publicUrl)
  if (!payload) throw new Error('avatar upload url missing from action result')
  const put = await fetch(payload.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': mime },
    body: bytes,
  })
  if (!put.ok) throw new Error(`avatar upload failed (HTTP ${put.status})`)
  return `${payload.publicUrl}?t=${Date.now()}`
}

function assertAvatarFile(filePath) {
  mimeFromPath(filePath)
  try {
    accessSync(filePath, constants.R_OK)
  } catch {
    throw new Error(`avatar file not readable: ${filePath}`)
  }
}

function profilePatchFromFlags(values) {
  const patch = {}
  if (values.name !== undefined) patch.fullName = values.name
  if (values.blurb !== undefined) patch.blurb = values.blurb
  if (values.skills !== undefined) patch.skills = parseCsv(values.skills)
  if (values.interests !== undefined) patch.interests = parseCsv(values.interests)
  if (values['looking-for'] !== undefined) patch.lookingFor = normalizeLookingFor(values['looking-for'])
  if (values['idea-status'] !== undefined) patch.ideaStatus = normalizeIdeaStatus(values['idea-status'])
  if (values.linkedin !== undefined) patch.linkedin = values.linkedin
  if (values.calendar !== undefined) patch.calendarUrl = values.calendar
  return patch
}

function summarizeProfile(p) {
  return [
    `name       ${p.fullName}`,
    `blurb      ${(p.blurb || '').replace(/\n/g, ' / ')}`,
    `skills     ${(p.skills || []).join(', ') || '—'}`,
    `interests  ${(p.interests || []).join(', ') || '—'}`,
    `looking    ${p.lookingFor ?? '—'}`,
    `idea       ${p.ideaStatus ?? '—'}`,
    `linkedin   ${p.linkedin || '—'}`,
    `calendar   ${p.calendarUrl || '—'}`,
    `avatar     ${p.avatarUrl || '—'}`,
  ].join('\n  ')
}

async function saveProfile(next, yes, label = 'update profile', { pendingAvatarPath } = {}) {
  // Validate/normalize before confirm+upload; pending path is a non-empty avatar placeholder.
  const preview = normalizeProfilePayload(
    pendingAvatarPath ? { ...next, avatarUrl: pendingAvatarPath } : next,
  )
  if (!(await confirmWrite(`${label}:\n  ${summarizeProfile(preview)}`, yes))) {
    console.log('  cancelled')
    return false
  }
  let final = preview
  if (pendingAvatarPath) {
    final = { ...preview, avatarUrl: await uploadAvatar(pendingAvatarPath) }
  }
  await jsonAction('updateProfile', [final])
  console.log('  ok · profile saved')
  return true
}

async function cmdProfileSet(values) {
  const patch = profilePatchFromFlags(values)
  let pendingAvatarPath = null
  if (values.avatar) {
    assertAvatarFile(values.avatar)
    pendingAvatarPath = values.avatar
  }
  if (Object.keys(patch).length === 0 && !pendingAvatarPath) {
    throw new Error(
      'usage: redwood profile set [--name ...] [--blurb ...] [--skills csv] [--interests csv] [--looking-for ...] [--idea-status ...] [--linkedin ...] [--calendar ...] [--avatar path] [--yes]',
    )
  }
  await ensureLogin()
  const current = await loadProfileState()
  const next = mergeProfile(current, patch)
  await saveProfile(next, values.yes, 'update profile', { pendingAvatarPath })
}

async function cmdProfileEdit(yes) {
  await ensureLogin()
  const current = await loadProfileState()
  console.log(`\n  profile edit (enter keeps; ${CLEAR} clears optional fields)\n`)
  const fullName = (await ask(`  name [${current.fullName}]: `)) || current.fullName
  const blurb = applyPromptValue(
    await ask(`  blurb [${(current.blurb || '').slice(0, 40)}…] (${CLEAR} clears): `),
    current.blurb,
  )
  const skillsRaw = await ask(`  skills csv [${(current.skills || []).join(', ')}]: `)
  const interestsRaw = await ask(`  interests csv [${(current.interests || []).join(', ')}]: `)
  const looking = await ask(
    `  looking-for (${LOOKING_FOR.join('|')}|none) [${current.lookingFor ?? 'none'}]: `,
  )
  const idea = await ask(
    `  idea-status (${IDEA_STATUS.join('|')}|none) [${current.ideaStatus ?? 'none'}]: `,
  )
  const linkedin = applyPromptValue(
    await ask(`  linkedin [${current.linkedin}] (${CLEAR} clears): `),
    current.linkedin,
  )
  const calendar = applyPromptValue(
    await ask(`  calendar [${current.calendarUrl}] (${CLEAR} clears): `),
    current.calendarUrl,
  )
  const avatarPath = await ask('  avatar file path (empty skips): ')
  const patch = {
    fullName,
    blurb,
    skills: skillsRaw ? parseCsv(skillsRaw) : current.skills,
    interests: interestsRaw ? parseCsv(interestsRaw) : current.interests,
    lookingFor: looking ? normalizeLookingFor(looking) : current.lookingFor,
    ideaStatus: idea ? normalizeIdeaStatus(idea) : current.ideaStatus,
    linkedin,
    calendarUrl: calendar,
  }
  let pendingAvatarPath = null
  if (avatarPath) {
    assertAvatarFile(avatarPath)
    pendingAvatarPath = avatarPath
  }
  const next = mergeProfile(current, patch)
  await saveProfile(next, yes, 'update profile', { pendingAvatarPath })
}

async function cmdTeamCreate(name, values) {
  const teamName = String(name || '').trim()
  if (!teamName) throw new Error('usage: redwood team create <name> [--one-liner ...] [--link ...] [--looking-for csv] [--yes]')
  await ensureLogin()
  const oneLiner = values['one-liner'] !== undefined ? String(values['one-liner']).trim() : ''
  const link = values.link !== undefined ? String(values.link).trim() : ''
  const lookingFor = values['looking-for'] !== undefined ? parseCsv(values['looking-for']) : []
  const summary = `create team "${teamName}"\n  one-liner  ${oneLiner || '—'}\n  link       ${link || '—'}\n  looking    ${lookingFor.join(', ') || '—'}`
  if (!(await confirmWrite(summary, values.yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('createTeam', [teamName, oneLiner, link, lookingFor])
  console.log('  ok · team created')
}

async function cmdTeamUpdate(values) {
  await ensureLogin()
  const state = await loadPeopleState()
  const team = requireTeam(state, { owner: true })
  const name = String(values.name !== undefined ? values.name : team.name).trim()
  const oneLiner =
    values['one-liner'] !== undefined
      ? String(values['one-liner']).trim()
      : String(team.oneLiner ?? '').trim()
  const link =
    values.link !== undefined ? String(values.link).trim() : String(team.link ?? '').trim()
  const status =
    values.status !== undefined ? normalizeTeamStatus(values.status) : team.status || 'open'
  const lookingFor =
    values['looking-for'] !== undefined ? parseCsv(values['looking-for']) : team.lookingFor || []
  const summary = `update team "${team.name}" → "${name}"\n  status ${status}\n  one-liner ${oneLiner || '—'}\n  link ${link || '—'}\n  looking ${lookingFor.join(', ') || '—'}`
  if (!(await confirmWrite(summary, values.yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('updateTeam', [team.id, name, oneLiner, link, status, lookingFor])
  console.log('  ok · team updated')
}

async function cmdTeamInvite(who, yes) {
  if (!who) throw new Error('usage: redwood team invite <exact name or UUID> [--yes]')
  await ensureLogin()
  const state = await loadPeopleState()
  const team = requireTeam(state, { owner: true })
  const person = resolveExactName(state.people, who)
  if (!(await confirmWrite(`invite ${person.name} to ${team.name}`, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('inviteMember', [team.id, person.id])
  console.log('  ok · invite sent')
}

async function cmdTeamRespond(teamQuery, decision, yes) {
  const d = String(decision || '').toLowerCase()
  if (!teamQuery || (d !== 'accept' && d !== 'decline')) {
    throw new Error('usage: redwood team respond <exact team name or UUID> <accept|decline> [--yes]')
  }
  await ensureLogin()
  const state = await loadPeopleState()
  const invite = resolveExactName(state.invites, teamQuery, { idKey: 'teamId', nameKey: 'teamName' })
  const accept = d === 'accept'
  if (!(await confirmWrite(`${d} invite to ${invite.teamName}`, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('respondInvite', [invite.teamId, accept])
  console.log(`  ok · invite ${d}ed`)
}

async function cmdTeamLeave(yes) {
  await ensureLogin()
  const state = await loadPeopleState()
  const team = requireTeam(state)
  if (!(await confirmWrite(`leave team ${team.name}`, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('leaveTeam', [team.id])
  console.log('  ok · left team')
}

async function cmdTeamDisband(yes) {
  await ensureLogin()
  const state = await loadPeopleState()
  const team = requireTeam(state, { owner: true })
  if (!(await confirmWrite(`DISBAND team ${team.name} (destructive)`, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('disbandTeam', [team.id])
  console.log('  ok · team disbanded')
}

async function cmdTeamRemove(who, yes) {
  if (!who) throw new Error('usage: redwood team remove <exact name or UUID> [--yes]')
  await ensureLogin()
  const state = await loadPeopleState()
  const team = requireTeam(state, { owner: true })
  const person = resolveExactName(team.members || [], who)
  if (!(await confirmWrite(`remove ${person.name} from ${team.name}`, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('removeMember', [team.id, person.id])
  console.log('  ok · member removed')
}

async function cmdTeamTransfer(who, yes) {
  if (!who) throw new Error('usage: redwood team transfer <exact name or UUID> [--yes]')
  await ensureLogin()
  const state = await loadPeopleState()
  const team = requireTeam(state, { owner: true })
  const person = resolveExactName(team.members || [], who)
  if (!(await confirmWrite(`transfer ownership of ${team.name} to ${person.name}`, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('transferOwnership', [team.id, person.id])
  console.log('  ok · ownership transferred')
}

async function cmdAdminHide(teamQuery, hidden, yes) {
  if (!teamQuery) throw new Error(`usage: redwood admin ${hidden ? 'hide' : 'unhide'} <team name or UUID> [--yes]`)
  await ensureLogin()
  const state = await loadPeopleState()
  requireAdmin(state)
  const team = resolveExactName(state.teams, teamQuery)
  if (!(await confirmWrite(`${hidden ? 'hide' : 'unhide'} team ${team.name}`, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('setTeamHidden', [team.id, hidden])
  console.log(`  ok · team ${hidden ? 'hidden' : 'unhidden'}`)
}

async function cmdAdminMentor(teamQuery, mentorQuery, yes) {
  if (!teamQuery || mentorQuery == null) {
    throw new Error('usage: redwood admin mentor <team> <person name|UUID|none> [--yes]')
  }
  await ensureLogin()
  const state = await loadPeopleState()
  requireAdmin(state)
  const team = resolveExactName(state.teams, teamQuery)
  let mentorId = null
  let mentorLabel = 'none'
  if (String(mentorQuery).toLowerCase() !== 'none') {
    const mentors = (state.people || []).filter((p) => p.isRfTeam)
    const mentor = resolveExactName(mentors, mentorQuery)
    mentorId = mentor.id
    mentorLabel = mentor.name
  }
  if (!(await confirmWrite(`set mentor of ${team.name} to ${mentorLabel}`, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('setTeamMentor', [team.id, mentorId])
  console.log('  ok · mentor updated')
}

async function cmdAdminInvite(teamQuery, personQuery, accept, yes) {
  const verb = accept ? 'accept' : 'decline'
  if (!teamQuery || !personQuery) {
    throw new Error(`usage: redwood admin ${verb} <team> <person> [--yes]`)
  }
  await ensureLogin()
  const state = await loadPeopleState()
  requireAdmin(state)
  const team = resolveExactName(state.teams, teamQuery)
  const person = resolveExactName(state.people, personQuery)
  if (!(await confirmWrite(`admin ${verb} invite: ${person.name} → ${team.name}`, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction(accept ? 'adminAcceptInvite' : 'adminDeclineInvite', [team.id, person.id])
  console.log(`  ok · invite ${verb}ed`)
}

async function cmdViewAs(who, yes) {
  if (!who) throw new Error('usage: redwood view-as <person name|UUID|clear> [--yes]')
  await ensureLogin()
  const state = await loadPeopleState()
  requireAdmin(state)
  let personId = null
  let label = 'clear (yourself)'
  if (String(who).toLowerCase() !== 'clear') {
    const pool = state.viewAsUsers?.length ? state.viewAsUsers : state.people
    const person = resolveExactName(pool, who)
    personId = person.id
    label = person.name
  }
  if (!(await confirmWrite(`view as ${label}`, yes))) {
    console.log('  cancelled')
    return
  }
  await jsonAction('setViewAs', [personId])
  console.log(`  ok · viewing as ${label}`)
}

async function guidedCommitment() {
  const week = await ask('  week (1-8): ')
  const text = await ask('  commitment text: ')
  await cmdCommitment(week, text, false)
}

async function guidedShip() {
  const week = await ask('  week (1-8): ')
  const url = await ask('  ship url: ')
  const note = await ask('  note (optional): ')
  await cmdShip(week, url, note, false)
}

async function guidedTeamMenu() {
  for (;;) {
    const choice = await pick('team writes', TEAM_WRITE_MENU)
    if (!choice || choice.action === 'back') return
    if (choice.action === 'team-create') {
      const name = await ask('  team name: ')
      const one = await ask(`  one-liner (optional; ${CLEAR} clears): `)
      const link = await ask(`  link (optional; ${CLEAR} clears): `)
      const looking = await ask(`  looking-for csv (optional; ${CLEAR} clears): `)
      await cmdTeamCreate(name, {
        'one-liner': one === CLEAR ? '' : one || '',
        link: link === CLEAR ? '' : link || '',
        'looking-for': looking === CLEAR ? '' : looking || undefined,
        yes: false,
      })
    } else if (choice.action === 'team-update') {
      const name = await ask('  name (empty keeps): ')
      const one = await ask(`  one-liner (empty keeps; ${CLEAR} clears): `)
      const link = await ask(`  link (empty keeps; ${CLEAR} clears): `)
      const status = await ask('  status open|closed (empty keeps): ')
      const looking = await ask(`  looking-for csv (empty keeps; ${CLEAR} clears): `)
      const values = { yes: false }
      if (name) values.name = name
      if (one === CLEAR) values['one-liner'] = ''
      else if (one) values['one-liner'] = one
      if (link === CLEAR) values.link = ''
      else if (link) values.link = link
      if (status) values.status = status
      if (looking === CLEAR) values['looking-for'] = ''
      else if (looking) values['looking-for'] = looking
      await cmdTeamUpdate(values)
    } else if (choice.action === 'team-invite') {
      await cmdTeamInvite(await ask('  person exact name or UUID: '), false)
    } else if (choice.action === 'team-respond') {
      const team = await ask('  invite team exact name or UUID: ')
      const decision = await ask('  accept|decline: ')
      await cmdTeamRespond(team, decision, false)
    } else if (choice.action === 'team-leave') await cmdTeamLeave(false)
    else if (choice.action === 'team-remove') {
      await cmdTeamRemove(await ask('  member exact name or UUID: '), false)
    } else if (choice.action === 'team-transfer') {
      await cmdTeamTransfer(await ask('  new owner exact name or UUID: '), false)
    } else if (choice.action === 'team-disband') await cmdTeamDisband(false)
    await ask('  enter to continue…')
  }
}

async function writeMenuLoop() {
  for (;;) {
    clearScreen()
    console.log('')
    const choice = await pick('write', WRITE_MENU)
    if (!choice || choice.action === 'back') return
    try {
      if (choice.action === 'commitment') await guidedCommitment()
      else if (choice.action === 'ship') await guidedShip()
      else if (choice.action === 'profile-edit') await cmdProfileEdit(false)
      else if (choice.action === 'team') await guidedTeamMenu()
    } catch (e) {
      console.log('  ' + (e.message || e))
    }
    await ask('  enter to continue…')
  }
}

async function getPage(path) {
  const session = loadSession()
  if (!session.cookies) throw new AuthError('not logged in')
  const res = await fetch(BASE + path, {
    headers: { accept: 'text/html', cookie: session.cookies },
    redirect: 'manual',
  })
  const cookies = parseSetCookie(res, session.cookies)
  if (cookies) saveSession({ ...session, cookies })
  return {
    status: res.status,
    location: res.headers.get('location'),
    html: await res.text(),
  }
}

function ensureAuthed(r) {
  if (r.status >= 300 && r.status < 400 && (r.location || '').includes('auth')) {
    throw new AuthError()
  }
  if (r.html.includes('login to your account')) throw new AuthError()
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`page unavailable (HTTP ${r.status})`)
  }
}

async function ensureLogin() {
  if (!hasSession()) await doLogin()
}

async function whoAmI() {
  try {
    const prof = await getPage('/batch1/profile')
    ensureAuthed(prof)
    return profileName(prof.html)
  } catch {
    return ''
  }
}

async function oneShot(path) {
  await ensureLogin()
  const r = await getPage(path)
  ensureAuthed(r)
  console.log(formatPage(path, r.html))
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
  // ponytail: full menu redraw; clamp if terminal shorter than menu
  const maxVisible = Math.max(4, (stdout.rows || 40) - 6)
  let idx = Math.max(0, Math.min(start, items.length - 1))
  let rows = 0
  hideCursor()
  const draw = () => {
    if (rows > 0) stdout.write(`\x1b[${rows}A`)
    let from = 0
    if (items.length > maxVisible) {
      from = Math.max(0, Math.min(idx - Math.floor(maxVisible / 2), items.length - maxVisible))
    }
    const view = items.slice(from, from + maxVisible)
    const lines = [`  ${title}`, '']
    if (from > 0) lines.push('  …')
    for (let i = 0; i < view.length; i++) {
      const real = from + i
      const cur = real === idx
      lines.push(
        `  ${cur ? '›' : ' '} ${cur ? `\x1b[1m${view[i].label}\x1b[0m` : view[i].label}`,
      )
    }
    if (from + view.length < items.length) lines.push('  …')
    lines.push('', '  ↑/↓/k/j move  ·  enter open  ·  q quit')
    stdout.write(lines.map((l) => l + '\x1b[K').join('\n') + '\n')
    rows = lines.length
  }
  draw()
  return readKeys((_str, key, done) => {
    if (!key) return
    if ((key.ctrl && key.name === 'c') || key.name === 'escape' || key.name === 'q') {
      showCursor()
      return done(null)
    }
    if (key.name === 'up' || key.name === 'k') {
      idx = (idx - 1 + items.length) % items.length
      return draw()
    }
    if (key.name === 'down' || key.name === 'j') {
      idx = (idx + 1) % items.length
      return draw()
    }
    if (key.name === 'return' || key.name === 'enter') {
      showCursor()
      done(items[idx])
    }
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
    if (e instanceof AuthError) {
      clearSession()
      return 'relogin'
    }
  }
  console.log('\n  ─')
  if (!stdin.isTTY) return 'back'
  stdout.write('  enter back to menu  ·  q quit')
  return readKeys((_str, key, done) => {
    if (!key) return
    if ((key.ctrl && key.name === 'c') || key.name === 'q' || key.name === 'escape') {
      return done('quit')
    }
    if (key.name === 'return' || key.name === 'enter' || key.name === 'backspace') {
      done('back')
    }
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
  if (!AUTH_COOKIE_RE.test(r.cookies || '')) {
    throw new Error(
      'login failed — server action id may be stale (see README: refreshing server action IDs)',
    )
  }
  const who = await whoAmI()
  console.log(who ? `\n  welcome, ${who}\n` : '\n  logged in\n')
  return who
}

async function menuLoop(startIdx = 0) {
  let idx = startIdx
  for (;;) {
    await ensureLogin()
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
    if (choice.action === 'write') {
      await writeMenuLoop()
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

Writes (every mutation confirms; use --yes for non-interactive):
  redwood commitment <1-8> <text> [--yes]
  redwood ship <1-8> <url> [note] [--yes]
  redwood profile edit
  redwood profile set [--name ...] [--blurb ...] [--skills csv]
                      [--interests csv] [--looking-for cofounder|teammates|chatting|not_looking|none]
                      [--idea-status committed|few_ideas|exploring|none]
                      [--linkedin ...] [--calendar ...] [--avatar path] [--yes]
  redwood team create <name> [--one-liner ...] [--link ...] [--looking-for csv] [--yes]
  redwood team update [--name ...] [--one-liner ...] [--link ...] [--status open|closed]
                      [--looking-for csv] [--yes]
  redwood team invite <exact name|UUID> [--yes]
  redwood team respond <exact team name|UUID> <accept|decline> [--yes]
  redwood team leave|disband [--yes]
  redwood team remove|transfer <exact name|UUID> [--yes]
  redwood admin hide|unhide <team name|UUID> [--yes]
  redwood admin mentor <team> <person|none> [--yes]
  redwood admin accept|decline <team> <person> [--yes]
  redwood view-as <person|clear> [--yes]

Pages:
  home  welcome  activity  people  mentors
  credits  profile  demo-day

Menu keys:  ↑/↓/k/j  enter  q

Session file: ${STATE}
Requires Node.js 18.17+ (built-in fetch + getSetCookie).
Action IDs are build hashes — refresh after a site deploy (see README).
`)
}

function resolvePath(cmd, a) {
  if (cmd === 'week') {
    const n = Number(a)
    if (!n || n < 1 || n > 8) return null
    return `/batch1/weeks/${n}`
  }
  return PAGE_ALIASES[cmd] || null
}

// ── main ─────────────────────────────────────────────────────────────

let values, positionals
try {
  ;({ values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      yes: { type: 'boolean', short: 'y' },
      name: { type: 'string' },
      blurb: { type: 'string' },
      skills: { type: 'string' },
      interests: { type: 'string' },
      'looking-for': { type: 'string' },
      'idea-status': { type: 'string' },
      linkedin: { type: 'string' },
      calendar: { type: 'string' },
      avatar: { type: 'string' },
      'one-liner': { type: 'string' },
      link: { type: 'string' },
      status: { type: 'string' },
    },
  }))
} catch (e) {
  console.error(String(e.message || e))
  usage()
  process.exit(1)
}

const [cmd, a, b, ...rest] = positionals

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
        const who = await whoAmI()
        if (who) console.log(`\n  hi ${who}`)
      } catch (e) {
        if (e instanceof AuthError) {
          clearSession()
          await doLogin()
        } else throw e
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

  if (cmd === 'commitment') {
    const text = [b, ...rest].filter((x) => x != null).join(' ')
    await cmdCommitment(a, text, values.yes)
    process.exit(0)
  }

  if (cmd === 'ship') {
    const note = rest.length ? rest.join(' ') : ''
    await cmdShip(a, b, note, values.yes)
    process.exit(0)
  }

  if (cmd === 'profile') {
    if (a === 'edit') {
      await cmdProfileEdit(values.yes)
      process.exit(0)
    }
    if (a === 'set') {
      await cmdProfileSet(values)
      process.exit(0)
    }
    // fall through to page alias when just `redwood profile`
  }

  if (cmd === 'team') {
    if (a === 'create') {
      await cmdTeamCreate(b, values)
      process.exit(0)
    }
    if (a === 'update') {
      await cmdTeamUpdate(values)
      process.exit(0)
    }
    if (a === 'invite') {
      await cmdTeamInvite(b, values.yes)
      process.exit(0)
    }
    if (a === 'respond') {
      await cmdTeamRespond(b, rest[0] ?? positionals[3], values.yes)
      process.exit(0)
    }
    if (a === 'leave') {
      await cmdTeamLeave(values.yes)
      process.exit(0)
    }
    if (a === 'disband') {
      await cmdTeamDisband(values.yes)
      process.exit(0)
    }
    if (a === 'remove') {
      await cmdTeamRemove(b, values.yes)
      process.exit(0)
    }
    if (a === 'transfer') {
      await cmdTeamTransfer(b, values.yes)
      process.exit(0)
    }
    console.error('usage: redwood team <create|update|invite|respond|leave|disband|remove|transfer> …')
    process.exit(1)
  }

  if (cmd === 'admin') {
    if (a === 'hide') {
      await cmdAdminHide(b, true, values.yes)
      process.exit(0)
    }
    if (a === 'unhide') {
      await cmdAdminHide(b, false, values.yes)
      process.exit(0)
    }
    if (a === 'mentor') {
      await cmdAdminMentor(b, rest[0] ?? positionals[3], values.yes)
      process.exit(0)
    }
    if (a === 'accept') {
      await cmdAdminInvite(b, rest[0] ?? positionals[3], true, values.yes)
      process.exit(0)
    }
    if (a === 'decline') {
      await cmdAdminInvite(b, rest[0] ?? positionals[3], false, values.yes)
      process.exit(0)
    }
    console.error('usage: redwood admin <hide|unhide|mentor|accept|decline> …')
    process.exit(1)
  }

  if (cmd === 'view-as') {
    await cmdViewAs(a, values.yes)
    process.exit(0)
  }

  const path = resolvePath(cmd, a)
  if (cmd === 'week' && !path) {
    console.error('usage: redwood week <1-8>')
    process.exit(1)
  }
  if (path) {
    await oneShot(path)
    process.exit(0)
  }

  console.error('unknown:', cmd)
  usage()
  process.exit(1)
} catch (e) {
  if (stdout.isTTY) showCursor()
  if (stdin.isTTY) {
    try {
      stdin.setRawMode(false)
    } catch {}
  }
  console.error('\n  ' + String(e.message || e) + '\n')
  process.exit(1)
}
