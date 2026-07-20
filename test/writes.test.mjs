import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeRscHtml,
  extractJsonValue,
  extractProfileState,
  extractPeopleState,
  resolveExactName,
  parseActionResult,
  mergeProfile,
  parseCsv,
  normalizeLookingFor,
  normalizeIdeaStatus,
  normalizeTeamStatus,
  normalizeLinkedin,
  normalizeCalendarUrl,
  normalizeProfilePayload,
  mimeFromPath,
  applyPromptValue,
  CLEAR,
  isUuid,
  confirmMode,
} from '../writes.mjs'

function rscHtml(chunks) {
  return chunks
    .map((c) => `self.__next_f.push([1,${JSON.stringify(c)}])`)
    .join('\n')
}

test('decodeRscHtml concatenates push chunks in order', () => {
  const html = rscHtml(['hello ', 'world'])
  assert.equal(decodeRscHtml(html), 'hello world')
})

test('extractJsonValue reads objects, arrays, strings, null', () => {
  const src =
    'x,"myTeam":{"id":"t1","name":"Alpha","members":[{"id":"p1","name":"Ada"}]},"invites":[],"label":"hi","gone":null,y'
  assert.deepEqual(extractJsonValue(src, 'myTeam'), {
    id: 't1',
    name: 'Alpha',
    members: [{ id: 'p1', name: 'Ada' }],
  })
  assert.deepEqual(extractJsonValue(src, 'invites'), [])
  assert.equal(extractJsonValue(src, 'label'), 'hi')
  assert.equal(extractJsonValue(src, 'gone'), null)
  assert.equal(extractJsonValue(src, 'missing'), undefined)
})

test('extractProfileState from RSC props', () => {
  const html = rscHtml([
    '[$,"$L16",null,{"initialName":"Ada Lovelace","initialAvatarUrl":"https://a.example/a.jpg","initialLinkedin":"in/ada","initialBlurb":"line1\\nline2","initialSkills":["engineering","design"],"initialInterests":["ai"],"initialLookingFor":"cofounder","initialIdeaStatus":"exploring","initialCalendarUrl":"cal.example/ada"}]',
  ])
  assert.deepEqual(extractProfileState(html), {
    fullName: 'Ada Lovelace',
    avatarUrl: 'https://a.example/a.jpg',
    linkedin: 'in/ada',
    blurb: 'line1\nline2',
    skills: ['engineering', 'design'],
    interests: ['ai'],
    lookingFor: 'cofounder',
    ideaStatus: 'exploring',
    calendarUrl: 'cal.example/ada',
  })
})

test('extractPeopleState from RSC props', () => {
  const html = rscHtml([
    '{"myTeam":{"id":"t1","name":"Alpha","role":"owner","members":[{"id":"p1","name":"Ada","role":"owner"}],"status":"open","lookingFor":[],"oneLiner":null,"link":null,"mentor":null},"invites":[{"teamId":"t2","teamName":"Beta"}],"people":[{"id":"p1","name":"Ada","isRfTeam":false},{"id":"p2","name":"Bob","isRfTeam":false}],"teams":[{"id":"t1","name":"Alpha","status":"open","memberIds":["p1"],"mentor":null}],"viewer":{"id":"p1"},"isAdmin":true,"viewAsUsers":[{"id":"p2","name":"Bob"}],"viewAsTarget":null}',
  ])
  const state = extractPeopleState(html)
  assert.equal(state.myTeam.name, 'Alpha')
  assert.equal(state.invites[0].teamName, 'Beta')
  assert.equal(state.people.length, 2)
  assert.equal(state.teams[0].id, 't1')
  assert.equal(state.viewer.id, 'p1')
  assert.equal(state.isAdmin, true)
  assert.equal(state.viewAsUsers[0].name, 'Bob')
  assert.equal(state.viewAsTarget, null)
})

test('resolveExactName: uuid passthrough, exact case-insensitive, reject missing/ambiguous', () => {
  const people = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Ada Lovelace' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Ada' },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Bob' },
    { id: '44444444-4444-4444-8444-444444444444', name: 'Ada' },
  ]
  assert.equal(
    resolveExactName(people, '11111111-1111-4111-8111-111111111111').id,
    '11111111-1111-4111-8111-111111111111',
  )
  assert.equal(resolveExactName(people, 'bob').name, 'Bob')
  assert.equal(resolveExactName(people, 'ada lovelace').name, 'Ada Lovelace')
  assert.throws(() => resolveExactName(people, 'Ada'), /ambiguous/i)
  assert.throws(() => resolveExactName(people, 'Zoe'), /not found/i)
  assert.throws(() => resolveExactName(people, '00000000-0000-4000-8000-000000000000'), /not found/i)
})

test('isUuid', () => {
  assert.equal(isUuid('11111111-1111-4111-8111-111111111111'), true)
  assert.equal(isUuid('Ada'), false)
})

test('parseActionResult success and error', () => {
  assert.deepEqual(parseActionResult('0:null\n1:{"success":true}\n'), {
    ok: true,
    payloads: [{ success: true }],
  })
  assert.deepEqual(parseActionResult('1:{"error":"nope"}\n'), {
    ok: false,
    error: 'nope',
    payloads: [{ error: 'nope' }],
  })
  assert.deepEqual(parseActionResult('not-rsc', 500), {
    ok: false,
    error: 'HTTP 500',
    payloads: [],
  })
})

test('mergeProfile preserves unspecified fields; applies patch', () => {
  const current = {
    fullName: 'Ada',
    avatarUrl: 'https://a',
    linkedin: 'in/ada',
    blurb: 'old',
    skills: ['engineering'],
    interests: ['ai'],
    lookingFor: 'cofounder',
    ideaStatus: 'exploring',
    calendarUrl: 'cal',
  }
  const merged = mergeProfile(current, { blurb: 'new', skills: ['design'] })
  assert.equal(merged.fullName, 'Ada')
  assert.equal(merged.blurb, 'new')
  assert.deepEqual(merged.skills, ['design'])
  assert.deepEqual(merged.interests, ['ai'])
})

test('parseCsv trims and drops empties', () => {
  assert.deepEqual(parseCsv(' a, b , ,c '), ['a', 'b', 'c'])
  assert.deepEqual(parseCsv(''), [])
})

test('normalize lookingFor / ideaStatus / team status', () => {
  assert.equal(normalizeLookingFor('cofounder'), 'cofounder')
  assert.equal(normalizeLookingFor('not_looking'), 'not_looking')
  assert.equal(normalizeLookingFor('none'), null)
  assert.equal(normalizeLookingFor(''), null)
  assert.throws(() => normalizeLookingFor('nope'), /looking-for/i)
  assert.equal(normalizeIdeaStatus('few_ideas'), 'few_ideas')
  assert.equal(normalizeIdeaStatus('none'), null)
  assert.throws(() => normalizeIdeaStatus('maybe'), /idea-status/i)
  assert.equal(normalizeTeamStatus('OPEN'), 'open')
  assert.throws(() => normalizeTeamStatus('maybe'), /status/i)
})

test('confirmMode: --yes / TTY prompt / non-TTY needs flag', () => {
  assert.equal(confirmMode({ yes: true, isTTY: false }), 'yes')
  assert.equal(confirmMode({ yes: false, isTTY: true }), 'prompt')
  assert.equal(confirmMode({ yes: false, isTTY: false }), 'need-flag')
})

test('mimeFromPath: supported types; reject unknown', () => {
  assert.equal(mimeFromPath('me.jpg'), 'image/jpeg')
  assert.equal(mimeFromPath('me.JPEG'), 'image/jpeg')
  assert.equal(mimeFromPath('/tmp/a.png'), 'image/png')
  assert.equal(mimeFromPath('a.webp'), 'image/webp')
  assert.equal(mimeFromPath('a.gif'), 'image/gif')
  assert.throws(() => mimeFromPath('a.bmp'), /unsupported avatar type/i)
  assert.throws(() => mimeFromPath('a.txt'), /unsupported avatar type/i)
})

test('normalizeLinkedin / normalizeCalendarUrl', () => {
  assert.equal(normalizeLinkedin('https://www.linkedin.com/in/ada'), 'linkedin.com/in/ada/')
  assert.equal(normalizeLinkedin('http://linkedin.com/in/ada/'), 'linkedin.com/in/ada/')
  assert.equal(normalizeLinkedin('www.linkedin.com/in/ada'), 'linkedin.com/in/ada/')
  assert.equal(normalizeLinkedin(''), '')
  assert.equal(normalizeLinkedin('  '), '')
  assert.equal(normalizeCalendarUrl('https://www.cal.com/ada'), 'cal.com/ada')
  assert.equal(normalizeCalendarUrl('http://cal.com/ada'), 'cal.com/ada')
  assert.equal(normalizeCalendarUrl(''), '')
})

test('normalizeProfilePayload trims, normalizes urls, requires name+avatar', () => {
  const base = {
    fullName: '  Ada  ',
    avatarUrl: ' https://a.example/a.jpg ',
    linkedin: 'https://www.linkedin.com/in/ada',
    blurb: '  hello  ',
    skills: ['engineering'],
    interests: [],
    lookingFor: 'cofounder',
    ideaStatus: null,
    calendarUrl: 'https://www.cal.com/ada',
  }
  assert.deepEqual(normalizeProfilePayload(base), {
    fullName: 'Ada',
    avatarUrl: 'https://a.example/a.jpg',
    linkedin: 'linkedin.com/in/ada/',
    blurb: 'hello',
    skills: ['engineering'],
    interests: [],
    lookingFor: 'cofounder',
    ideaStatus: null,
    calendarUrl: 'cal.com/ada',
  })
  assert.throws(() => normalizeProfilePayload({ ...base, fullName: '  ' }), /name is required/i)
  assert.throws(() => normalizeProfilePayload({ ...base, avatarUrl: '' }), /avatar URL is required/i)
})

test('applyPromptValue: empty keeps, - clears', () => {
  assert.equal(CLEAR, '-')
  assert.equal(applyPromptValue('', 'kept'), 'kept')
  assert.equal(applyPromptValue('-', 'kept'), '')
  assert.equal(applyPromptValue('new', 'kept'), 'new')
})
