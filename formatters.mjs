// HTML → terminal text for batch board pages.

const BASE = 'https://redwoodfounders.org'
const CHIP_RE =
  /rounded-full bg-white px-3 py-1\.5 text-sm font-medium text-\[#A11212\][^>]*>([^<]+)/g

export function sanitize(s) {
  // strip C0 controls except \t \n (terminal escape injection)
  return String(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

export function decodeEntities(s) {
  return sanitize(
    String(s)
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/<!--\s*-->/g, ''),
  )
}

function unwrapComments(s) {
  return decodeEntities(String(s).replace(/<!--\s*-->/g, '').replace(/\s+/g, ' ').trim())
}

export function wrap(text, width = 72, indent = '') {
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

function chipsIn(html, start, end) {
  if (start < 0) return []
  const slice = html.slice(start, end > start ? end : start + 3000)
  return [...slice.matchAll(CHIP_RE)].map((m) => decodeEntities(m[1]).trim())
}

export function profileName(html) {
  const name = html.match(/placeholder="full name"[^>]*value="([^"]*)"/i)?.[1]
  return name ? decodeEntities(name).trim() : ''
}

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

    const shipBlock = sec.match(/uppercase">shipped<\/span>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i)
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

    const commitBlock = sec.match(/uppercase">committed<\/span>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i)
    if (commitBlock) {
      lines.push('  committed')
      for (const li of commitBlock[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
        const who =
          li[1].match(/alt="([^"]+)"/)?.[1] ||
          li[1].match(/text-xs text-white\/45">([^<]+)/)?.[1]
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
        new RegExp(
          label + '[\\s\\S]*?<div class="flex flex-wrap gap-1\\.5">([\\s\\S]*?)<\\/div>',
          'i',
        ),
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
  // notion alt is split across imgs
  if (![...seen].some((s) => s.startsWith('Notion')) && /notion/i.test(html) && /6 months free/i.test(html)) {
    lines.push(`  ${'Notion'.padEnd(22)} 6 months free`)
  }
  return lines.join('\n').trim() || cleanText(html)
}

function formatProfile(html) {
  const lines = []
  const pct = html.match(/profile\s*(?:<!--\s*-->)?\s*(\d+)\s*(?:<!--\s*-->)?\s*% complete/i)
  if (pct) lines.push(`profile · ${pct[1]}% complete`, '')

  const name = profileName(html)
  const blurb = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i)?.[1]
  if (name) lines.push(`name       ${name}`)
  if (blurb) {
    const b = decodeEntities(blurb).trim()
    b.split('\n').forEach((p, i) => lines.push(i === 0 ? `blurb      ${p}` : `           ${p}`))
  }

  const skillsIdx = html.indexOf('>skills<')
  const interestsIdx = html.indexOf('>interests<')
  const lookingIdx = html.search(/>looking for</i)
  const ideaIdx = html.search(/>idea status</i)

  const skills = chipsIn(html, skillsIdx, interestsIdx)
  const interests = chipsIn(html, interestsIdx, lookingIdx)
  const looking = chipsIn(html, lookingIdx, ideaIdx)
  const idea = chipsIn(html, ideaIdx, ideaIdx + 2000)

  if (skills.length) lines.push(`skills     ${skills.join(', ')}`)
  if (interests.length) lines.push(`interests  ${interests.join(', ')}`)
  if (looking.length) lines.push(`looking    ${looking.join(', ')}`)
  if (idea.length) lines.push(`idea       ${idea.join(', ')}`)
  if (!skills.length && !interests.length) {
    const selected = [...html.matchAll(CHIP_RE)].map((m) => decodeEntities(m[1]).trim())
    if (selected.length) lines.push(`selected   ${selected.join(', ')}`)
  }

  // only visible text inputs (skip hidden / tokens)
  const linkVals = [
    ...html.matchAll(/<input(?![^>]*type=["']hidden["'])[^>]*value="([^"]*)"[^>]*>/gi),
  ]
    .map((m) => m[1])
    .filter((v) => v && v !== name)
  if (linkVals[0]) lines.push(`link       ${decodeEntities(linkVals[0])}`)
  if (linkVals[1]) lines.push(`calendar   ${decodeEntities(linkVals[1])}`)

  return lines.join('\n').trim() || cleanText(html)
}

function formatDemoDay(html) {
  const lines = ['demo day']
  const date = html.match(/demo day<\/h1>\s*<span[^>]*>([^<]+)/i)?.[1]
  if (date) lines.push(unwrapComments(date))
  const rest = cleanText(html)
    .split('\n')
    .filter(
      (l) =>
        !/^demo day$/i.test(l) &&
        !/^\d+$/.test(l) &&
        l.toLowerCase() !== unwrapComments(date || '').toLowerCase(),
    )
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
      const t = unwrapComments(spWhen.replace(/<[^>]+>/g, '')).replace(/^>/, '')
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

export function formatPage(path, html) {
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


