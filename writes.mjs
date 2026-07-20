// Pure helpers for board write actions (RSC extract, name resolve, profile merge).

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const LOOKING_FOR = ['cofounder', 'teammates', 'chatting', 'not_looking']
export const IDEA_STATUS = ['committed', 'few_ideas', 'exploring']
export const TEAM_STATUS = ['open', 'closed']

/** Build hashes — refresh after a site deploy (see README). */
export const WRITE_ACTIONS = {
  updateProfile: { id: '40c329b3f32536c9c3db0217f83993ab09666c6319', path: '/batch1/profile' },
  getAvatarUploadUrl: {
    id: '40fcf10b8f35054c6d75ba7608f1d217e1bda068d1',
    path: '/batch1/profile',
  },
  setIntention: { id: '607041f150ceda251b76348e61fbe31cb0efad04ca', path: null }, // /batch1/weeks/:n
  setShip: { id: '70ea70a88ace00a18bf860f311ff6da87faaffba83', path: null },
  createTeam: { id: '78cf7f961ef7ea61a71cfa038a2077920232f3bfe5', path: '/batch1/people' },
  updateTeam: { id: '7e2c8c5b103c76ff8b10835fb8d19a57c7685c89c5', path: '/batch1/people' },
  inviteMember: { id: '600bc4f3c86a12e76904119ae0c06a88dfb9a1f4aa', path: '/batch1/people' },
  respondInvite: { id: '604fd0ccdb5db0e2f289cb63cf27f7ff8a8bdd5ba7', path: '/batch1/people' },
  leaveTeam: { id: '404220c668581f46746822ff159aa0bb95325e2734', path: '/batch1/people' },
  removeMember: { id: '609299ecf76a34ff759e421749982f3c9922654a62', path: '/batch1/people' },
  transferOwnership: { id: '607fe469f8a58df8731b606cdcdb69f5ab4ff351ef', path: '/batch1/people' },
  disbandTeam: { id: '405320e287554c8e6423ff954aea9efd8688c87967', path: '/batch1/people' },
  setTeamHidden: { id: '60606dd0ffb98c7720dd8f16937b8a67b1ea0b16d4', path: '/batch1/people' },
  setTeamMentor: { id: '60af4841313506426e0a98b5da43716a540f629695', path: '/batch1/people' },
  adminAcceptInvite: { id: '60c03aad2e2e3982806e165faef87fa2203abc2e76', path: '/batch1/people' },
  adminDeclineInvite: { id: '60ea9a94f694269ed5890127f59e99c3d590aefdb3', path: '/batch1/people' },
  setViewAs: { id: '40aecd6ff28ceccbda297390d82d6af1613468c51c', path: '/batch1' },
}

export function isUuid(s) {
  return UUID_RE.test(String(s || ''))
}

export function decodeRscHtml(html) {
  const out = []
  const re = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g
  let m
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]))
    } catch {
      // skip malformed chunk
    }
  }
  return out.join('')
}

/** Extract a pure JSON value after `key":` using a bracket/string scanner. */
export function extractJsonValue(source, key) {
  const needle = `${key}":`
  const i = source.indexOf(needle)
  if (i < 0) return undefined
  let j = i + needle.length
  while (j < source.length && /\s/.test(source[j])) j++
  if (source.startsWith('null', j)) return null
  if (source.startsWith('true', j)) return true
  if (source.startsWith('false', j)) return false
  const ch = source[j]
  if (ch === '"') {
    let k = j + 1
    let esc = false
    while (k < source.length) {
      const c = source[k]
      if (esc) {
        esc = false
        k++
        continue
      }
      if (c === '\\') {
        esc = true
        k++
        continue
      }
      if (c === '"') return JSON.parse(source.slice(j, k + 1))
      k++
    }
    throw new Error(`unclosed string for ${key}`)
  }
  if (ch === '{' || ch === '[') {
    let depth = 0
    let inStr = false
    let esc = false
    for (let k = j; k < source.length; k++) {
      const c = source[k]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') {
        inStr = true
        continue
      }
      if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') {
        depth--
        if (depth === 0) return JSON.parse(source.slice(j, k + 1))
      }
    }
    throw new Error(`unclosed value for ${key}`)
  }
  const num = source.slice(j).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)
  if (num) return JSON.parse(num[0])
  return undefined
}

export function extractProfileState(html) {
  const src = decodeRscHtml(html)
  const fullName = extractJsonValue(src, 'initialName')
  if (fullName === undefined) throw new Error('could not read profile state from page')
  return {
    fullName: fullName ?? '',
    avatarUrl: extractJsonValue(src, 'initialAvatarUrl') ?? '',
    linkedin: extractJsonValue(src, 'initialLinkedin') ?? '',
    blurb: extractJsonValue(src, 'initialBlurb') ?? '',
    skills: extractJsonValue(src, 'initialSkills') ?? [],
    interests: extractJsonValue(src, 'initialInterests') ?? [],
    lookingFor: extractJsonValue(src, 'initialLookingFor') ?? null,
    ideaStatus: extractJsonValue(src, 'initialIdeaStatus') ?? null,
    calendarUrl: extractJsonValue(src, 'initialCalendarUrl') ?? '',
  }
}

export function extractPeopleState(html) {
  const src = decodeRscHtml(html)
  return {
    myTeam: extractJsonValue(src, 'myTeam') ?? null,
    invites: extractJsonValue(src, 'invites') ?? [],
    people: extractJsonValue(src, 'people') ?? [],
    teams: extractJsonValue(src, 'teams') ?? [],
    viewer: extractJsonValue(src, 'viewer') ?? null,
    isAdmin: extractJsonValue(src, 'isAdmin') === true,
    viewAsUsers: extractJsonValue(src, 'viewAsUsers') ?? [],
    viewAsTarget: extractJsonValue(src, 'viewAsTarget') ?? null,
  }
}

export function resolveExactName(items, query, { idKey = 'id', nameKey = 'name' } = {}) {
  const q = String(query || '').trim()
  if (!q) throw new Error('name or id required')
  if (isUuid(q)) {
    const hit = items.find((it) => String(it[idKey]).toLowerCase() === q.toLowerCase())
    if (!hit) throw new Error(`not found: ${q}`)
    return hit
  }
  const needle = q.toLowerCase()
  const hits = items.filter((it) => String(it[nameKey] || '').toLowerCase() === needle)
  if (hits.length === 0) throw new Error(`not found: ${q}`)
  if (hits.length > 1) throw new Error(`ambiguous name: ${q} (${hits.length} matches)`)
  return hits[0]
}

export function parseActionResult(text, status = 200) {
  const payloads = []
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\d+:(\{.*\})$/)
    if (!m) continue
    try {
      payloads.push(JSON.parse(m[1]))
    } catch {}
  }
  if (status < 200 || status >= 300) {
    return { ok: false, error: `HTTP ${status}`, payloads }
  }
  const err = payloads.find((p) => p && p.error != null)
  if (err) return { ok: false, error: String(err.error), payloads }
  return { ok: true, payloads }
}

export function mergeProfile(current, patch) {
  return {
    fullName: patch.fullName !== undefined ? patch.fullName : current.fullName,
    avatarUrl: patch.avatarUrl !== undefined ? patch.avatarUrl : current.avatarUrl,
    linkedin: patch.linkedin !== undefined ? patch.linkedin : current.linkedin,
    blurb: patch.blurb !== undefined ? patch.blurb : current.blurb,
    skills: patch.skills !== undefined ? patch.skills : current.skills,
    interests: patch.interests !== undefined ? patch.interests : current.interests,
    lookingFor: patch.lookingFor !== undefined ? patch.lookingFor : current.lookingFor,
    ideaStatus: patch.ideaStatus !== undefined ? patch.ideaStatus : current.ideaStatus,
    calendarUrl: patch.calendarUrl !== undefined ? patch.calendarUrl : current.calendarUrl,
  }
}

export function parseCsv(s) {
  if (s == null || s === '') return []
  return String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

export function normalizeLookingFor(v) {
  if (v == null || v === '' || String(v).toLowerCase() === 'none') return null
  const s = String(v).toLowerCase()
  if (!LOOKING_FOR.includes(s)) {
    throw new Error(`looking-for must be one of: ${LOOKING_FOR.join('|')}|none`)
  }
  return s
}

export function normalizeIdeaStatus(v) {
  if (v == null || v === '' || String(v).toLowerCase() === 'none') return null
  const s = String(v).toLowerCase()
  if (!IDEA_STATUS.includes(s)) {
    throw new Error(`idea-status must be one of: ${IDEA_STATUS.join('|')}|none`)
  }
  return s
}

export function normalizeTeamStatus(v) {
  const s = String(v || '').toLowerCase()
  if (!TEAM_STATUS.includes(s)) {
    throw new Error(`status must be one of: ${TEAM_STATUS.join('|')}`)
  }
  return s
}

const AVATAR_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

export function mimeFromPath(p) {
  const ext = String(p).toLowerCase().split('.').pop()
  const mime = AVATAR_MIME[ext]
  if (!mime) {
    throw new Error(`unsupported avatar type: .${ext} (use jpg|jpeg|png|webp|gif)`)
  }
  return mime
}

/** Interactive clear sentinel: `-` clears optional text; empty keeps current. */
export const CLEAR = '-'

export function applyPromptValue(input, current) {
  const s = String(input ?? '')
  if (s === CLEAR) return ''
  if (s === '') return current
  return s
}

function stripUrlPrefix(s) {
  return String(s || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
}

export function normalizeLinkedin(s) {
  const v = stripUrlPrefix(s)
  if (!v) return ''
  return v.endsWith('/') ? v : `${v}/`
}

export function normalizeCalendarUrl(s) {
  return stripUrlPrefix(s)
}

/** Website-parity profile payload before updateProfile. */
export function normalizeProfilePayload(p) {
  const fullName = String(p.fullName ?? '').trim()
  const avatarUrl = String(p.avatarUrl ?? '').trim()
  if (!fullName) throw new Error('name is required')
  if (!avatarUrl) throw new Error('avatar URL is required')
  return {
    fullName,
    avatarUrl,
    linkedin: normalizeLinkedin(p.linkedin),
    blurb: String(p.blurb ?? '').trim(),
    skills: p.skills ?? [],
    interests: p.interests ?? [],
    lookingFor: p.lookingFor ?? null,
    ideaStatus: p.ideaStatus ?? null,
    calendarUrl: normalizeCalendarUrl(p.calendarUrl),
  }
}

/** Confirmation gate: --yes auto-accepts; non-TTY without --yes must fail. */
export function confirmMode({ yes, isTTY }) {
  if (yes) return 'yes'
  if (!isTTY) return 'need-flag'
  return 'prompt'
}
