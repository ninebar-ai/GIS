import { v } from '../lobes'


const KEY = 'n1_openai_key'
const KEY_CLAUDE = 'n1_anthropic_key'
const KEY_USER_ID = 'n1_user_id'
const KEY_REF_CTX = 'n1_ref_ctx'
const KEY_FEEDBACK = 'n1_copilot_feedback'

export function recordFeedback(entry) {
  try {
    const key = `${KEY_FEEDBACK}_${getUserId()}`
    const hist = JSON.parse(localStorage.getItem(key) || '[]')
    hist.push({ ...entry, t: new Date().toISOString() })
    localStorage.setItem(key, JSON.stringify(hist.slice(-200)))
  } catch { /* */ }
}

// Optional per-browser overrides, sent as X-OpenAI-Key / X-Anthropic-Key. The
// server's .env keys are the normal path; these are only for a local override.
// (The matching setters were removed — nothing ever called them and no UI sets these.)
export function getKey() {
  return (localStorage.getItem(KEY) || '').trim()
}

export function getClaudeKey() {
  return (localStorage.getItem(KEY_CLAUDE) || '').trim()
}

export function getUserId() {
  let id = (localStorage.getItem(KEY_USER_ID) || '').trim()
  if (id) return id
  if (window.crypto?.randomUUID) id = `u_${window.crypto.randomUUID()}`
  else id = `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  localStorage.setItem(KEY_USER_ID, id)
  return id
}

const refKey = () => `${KEY_REF_CTX}_${getUserId()}`

export function readRefCtx() {
  try {
    const raw = localStorage.getItem(refKey())
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writeRefCtx(ctx) {
  try { localStorage.setItem(refKey(), JSON.stringify(ctx || {})) } catch {}
}

export function contextSite(ctx, selectedId, inv) {
  const sid = ctx.lastSiteId || ctx.lastNeighborSiteId || selectedId
  if (sid && inv?.sites?.some((s) => s.site_id === sid)) return sid
  return ctx.lastSiteId || ctx.lastNeighborSiteId || selectedId || null
}

function sortedSiteIds(inv) {
  return (inv?.sites || []).map((s) => s.site_id).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

function stepSite(inv, currentId, delta) {
  const ids = sortedSiteIds(inv)
  if (!ids.length) return null
  const idx = currentId ? ids.indexOf(currentId) : -1
  const nextIdx = idx < 0 ? (delta >= 0 ? 0 : ids.length - 1) : idx + delta
  if (nextIdx < 0 || nextIdx >= ids.length) return null
  return ids[nextIdx]
}

export function resolveReferences(text, inv, selectedId) {
  const raw = String(text || '').trim()
  if (!raw) return raw
  const ctx = readRefCtx()
  const alarms = inv.sites.filter((s) => s.in_alarm).map((s) => s.site_id)
  const planned = inv.sites.filter((s) => v(s.status) === 'planned').map((s) => s.site_id)
  const list = Array.isArray(ctx.lastSiteList) && ctx.lastSiteList.length ? ctx.lastSiteList : (alarms.length ? alarms : planned)
  const fallback = contextSite(ctx, selectedId, inv) || list[0]
  let out = raw
  if (fallback) out = out.replace(/\b(that site|that one|same site|previous site)\b/ig, fallback)
  if (fallback) {
    out = out.replace(/\b(neighbou?rs?\s+(?:of|for|near|around)\s+)(?:it|this|that)\b/ig, `$1${fallback}`)
    out = out.replace(/\b(?:show\s+(?:me\s+)?)?(?:its?|their)\s+neighbou?rs?\b/ig, `tier-1 neighbours for ${fallback}`)
    out = out.replace(/\b(?:what|which)\s+(?:are|is)\s+(?:its?|their)\s+neighbou?rs?\b/ig, `tier-1 neighbours for ${fallback}`)
  }
  const followSite = (token, cmd) => {
    const site = resolveSiteToken(inv, token)
    if (!site) return null
    if (cmd === 'dt') return `daily drive test near ${site.site_id}`
    if (cmd === 'gh') return 'show groundhog'
    if (cmd === 'holes') return 'coverage holes'
    return `tier-1 neighbours for ${site.site_id}`
  }
  const repeatForSiteId = (siteId, cmd) => {
    if (!siteId) return null
    if (cmd === 'dt') return `daily drive test near ${siteId}`
    if (cmd === 'gh') return 'show groundhog'
    if (cmd === 'holes') return 'coverage holes'
    return `tier-1 neighbours for ${siteId}`
  }
  const cmd = ctx.lastCommand || 'neighbors'
  const trimmed = out.trim()
  if (/^(?:now\s+)?(?:next(?:\s+(?:one|site))?|next\s+site)\s*$/i.test(trimmed)) {
    const nxt = stepSite(inv, fallback, 1)
    const rewritten = repeatForSiteId(nxt, cmd)
    if (rewritten) out = rewritten
  } else if (/^(?:now\s+)?(?:prev(?:ious)?(?:\s+(?:one|site))?|previous\s+site)\s*$/i.test(trimmed)) {
    const prev = stepSite(inv, fallback, -1)
    const rewritten = repeatForSiteId(prev, cmd)
    if (rewritten) out = rewritten
  }
  const sameFor = out.match(/\b(?:same|do\s+(?:it|that)|now)\s+(?:for|on)\s+((?:tok[-_\s]?)?[a-z0-9_]+)\b/i)
  if (sameFor?.[1]) {
    const rewritten = followSite(sameFor[1], cmd)
    if (rewritten) out = rewritten
  }
  const bareFor = out.match(/^(?:for|on)\s+((?:tok[-_\s]?)?[a-z0-9_]+)\s*$/i)
  if (bareFor?.[1]) {
    const rewritten = followSite(bareFor[1], cmd)
    if (rewritten) out = rewritten
  }
  const hasSiteToken = (s) => /\bTOK_[A-Z0-9_]+\b/i.test(String(s || ''))
  const areaRef = out.match(/\b(?:one|site)\s+in\s+([a-z0-9][a-z0-9\s_-]{1,30})\b/i)
  if (areaRef?.[1]) {
    const area = areaRef[1].trim().toLowerCase()
    const hit = inv.sites.find((s) => {
      const bag = Object.values(s || {}).map((x) => String(x || '').toLowerCase()).join(' ')
      return bag.includes(area)
    })
    if (hit?.site_id) out = out.replace(/\b(?:one|site)\s+in\s+[a-z0-9][a-z0-9\s_-]{1,30}\b/i, hit.site_id)
    else if (hasSiteToken(fallback)) out = out.replace(/\b(?:one|site)\s+in\s+[a-z0-9][a-z0-9\s_-]{1,30}\b/i, fallback)
  }
  const alarmRef = out.match(/\b(?:one|site)\s+with\s+([a-z0-9][a-z0-9\s_-]{1,30})\s+alarm\b/i)
  if (alarmRef?.[1]) {
    const alarmKey = alarmRef[1].trim().toLowerCase()
    const hit = inv.sites.find((s) => (s.alarms || []).some((a) => String(a?.problem || '').toLowerCase().includes(alarmKey)))
    if (hit?.site_id) out = out.replace(/\b(?:one|site)\s+with\s+[a-z0-9][a-z0-9\s_-]{1,30}\s+alarm\b/i, hit.site_id)
    else if (hasSiteToken(fallback)) out = out.replace(/\b(?:one|site)\s+with\s+[a-z0-9][a-z0-9\s_-]{1,30}\s+alarm\b/i, fallback)
  }
  const pickByOrdinal = (idx) => list[idx] || null
  const first = pickByOrdinal(0)
  const second = pickByOrdinal(1)
  const third = pickByOrdinal(2)
  if (first) out = out.replace(/\b(first one|first site|1st one|1st site)\b/ig, first)
  if (second) out = out.replace(/\b(second one|second site|2nd one|2nd site)\b/ig, second)
  if (third) out = out.replace(/\b(third one|third site|3rd one|3rd site)\b/ig, third)
  return out
}

export function rememberReferenceContext(intent, inv, selectedId, text) {
  const ctx = readRefCtx()
  const next = { ...ctx }
  const mention = String(text || '').toUpperCase().match(/\bTOK_[A-Z0-9_]+\b/)
  if (mention?.[0]) next.lastSiteId = mention[0]
  if (intent?.select) next.lastSiteId = intent.select
  if (intent?.siteId) next.lastSiteId = intent.siteId
  if (intent?.type === 'neighbors' && intent.siteId) {
    next.lastSiteId = intent.siteId
    next.lastNeighborSiteId = intent.siteId
    next.lastCommand = 'neighbors'
  } else if (intent?.section === 'dt') {
    next.lastCommand = 'dt'
    if (intent.select) next.lastSiteId = intent.select
  } else if (intent?.section === 'gh') {
    next.lastCommand = 'gh'
  } else if (intent?.section === 'holes') {
    next.lastCommand = 'holes'
  } else if (intent?.recipe?.inAlarm === true) {
    next.lastCommand = 'alarms'
  } else if (intent?.recipe?.status?.includes?.('planned')) {
    next.lastCommand = 'planned'
  }
  if (Array.isArray(intent?.siteList) && intent.siteList.length) next.lastSiteList = intent.siteList
  if (intent?.fly === 'alarms') {
    const alarms = inv.sites.filter((s) => s.in_alarm).map((s) => s.site_id)
    if (alarms.length) {
      next.lastSiteList = alarms
      if (!next.lastSiteId) next.lastSiteId = alarms[0]
    }
  }
  if (intent?.recipe?.status?.includes?.('planned')) {
    const planned = inv.sites.filter((s) => v(s.status) === 'planned').map((s) => s.site_id)
    if (planned.length) next.lastSiteList = planned
  }
  writeRefCtx(next)
}

export function resolveSiteToken(inv, token) {
  const raw = String(token || '').trim().toUpperCase()
  if (!raw) return null
  const direct = inv.sites.find((s) => s.site_id === raw || s.site_id === `TOK_${raw}`)
  if (direct) return direct
  if (/^\d+$/.test(raw)) {
    const suffix = inv.sites.filter((s) => s.site_id.endsWith(`_${raw}`) || s.site_id.endsWith(raw))
    if (suffix.length === 1) return suffix[0]
    if (suffix.length > 1) return suffix.find((s) => s.site_id === `TOK_${raw}`) || suffix[0]
  }
  const partial = inv.sites.filter((s) => s.site_id.includes(raw))
  if (partial.length === 1) return partial[0]
  return partial.find((s) => s.site_id.includes(raw)) || null
}
