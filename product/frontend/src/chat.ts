import { v } from './lobes.js'
import { defaultRecipe, nPts } from './filters.js'

const KEY = 'n1_openai_key'
const KEY_CLAUDE = 'n1_anthropic_key'
const KEY_USER_ID = 'n1_user_id'
const KEY_REF_CTX = 'n1_ref_ctx'

/** Verbs for the Copilot rail — labels are what the engineer sees; ask is what parseAsk matches. */
export function contextChips({ section, selected, inv } = {}) {
  const chips = []
  if (section === 'gh') {
    chips.push({ label: 'Drive test nearby', ask: selected ? `daily drive test near ${selected}` : 'daily drive test', hint: 'Switch to DT around current focus' })
    chips.push({ label: 'Coverage holes', ask: 'coverage holes', hint: 'Show GH <= -105 dBm zones' })
    chips.push({ label: 'Back to overview', ask: 'back to overview', hint: 'Reset map context' })
  } else if (section === 'dt') {
    chips.push({ label: 'Groundhog layer', ask: 'show groundhog', hint: 'Switch to GH heatmap' })
    chips.push({ label: 'Tier-1 neighbours', ask: selected ? `tier-1 neighbours for ${selected}` : 'tier-1 neighbours for TOK_001', hint: 'Start neighbour analysis' })
    chips.push({ label: 'Back to overview', ask: 'back to overview', hint: 'Reset map context' })
  } else if (section === 'holes') {
    chips.push({ label: 'Groundhog layer', ask: 'show groundhog', hint: 'Keep GH, hide holes' })
    chips.push({ label: 'Drive test nearby', ask: selected ? `daily drive test near ${selected}` : 'daily drive test', hint: 'Cross-check with DT' })
    chips.push({ label: 'Back to overview', ask: 'back to overview', hint: 'Reset map context' })
  } else if (section === 'neighbors') {
    chips.push({ label: 'Export audit JSON', ask: 'export neighbour audit json', hint: 'Save monitored set trail' })
    chips.push({ label: 'Export audit CSV', ask: 'export neighbour audit csv', hint: 'Save tabular audit' })
    chips.push({ label: 'Daily drive test', ask: selected ? `daily drive test near ${selected}` : 'daily drive test', hint: 'Inspect field route evidence' })
    chips.push({ label: 'Back to overview', ask: 'back to overview', hint: 'Reset map context' })
  } else {
    chips.push({ label: selected ? `Daily drive test near ${selected}` : 'Daily drive test', ask: selected ? `daily drive test near ${selected}` : 'daily drive test', hint: selected ? 'Focus DT around selected site' : 'Show DT with practical zoom' })
    chips.push({ label: selected ? `Tier-1 for ${selected}` : 'Tier-1 neighbours', ask: selected ? `tier-1 neighbours for ${selected}` : 'tier-1 neighbours for TOK_001', hint: 'Facing sectors within 1.2 km' })
    chips.push({ label: 'Sites in alarm', ask: 'sites in alarm', hint: 'Fault-focused shortlist' })
    chips.push({ label: 'Planned sites', ask: 'show planned sites', hint: 'Planned layer and filter' })
    chips.push({ label: 'Groundhog layer', ask: 'show groundhog', hint: 'Signal heatmap view' })
  }
  if (selected && inv?.sites?.some((s) => s.site_id === selected)) {
    if (section !== 'neighbors') chips.push({ label: `Tier-1 for ${selected}`, ask: `tier-1 neighbours for ${selected}`, hint: 'Facing sectors within 1.2 km' })
    chips.push({ label: `Alarms on ${selected}`, ask: `what alarms on ${selected}`, hint: 'Root cause and severity' })
    chips.push({ label: `Azimuth on ${selected}`, ask: `azimuth for ${selected}`, hint: 'Sector direction check' })
  }
  return chips
}

export function getKey() {
  return (localStorage.getItem(KEY) || '').trim()
}

export function setKey(value) {
  const v = (value || '').trim()
  if (v) localStorage.setItem(KEY, v)
  else localStorage.removeItem(KEY)
}

export function getClaudeKey() {
  return (localStorage.getItem(KEY_CLAUDE) || '').trim()
}

export function setClaudeKey(value) {
  const v = (value || '').trim()
  if (v) localStorage.setItem(KEY_CLAUDE, v)
  else localStorage.removeItem(KEY_CLAUDE)
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

function readRefCtx() {
  try {
    const raw = localStorage.getItem(refKey())
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeRefCtx(ctx) {
  try { localStorage.setItem(refKey(), JSON.stringify(ctx || {})) } catch {}
}

function resolveReferences(text, inv, selectedId) {
  const raw = String(text || '').trim()
  if (!raw) return raw
  const ctx = readRefCtx()
  const alarms = inv.sites.filter((s) => s.in_alarm).map((s) => s.site_id)
  const planned = inv.sites.filter((s) => v(s.status) === 'planned').map((s) => s.site_id)
  const list = Array.isArray(ctx.lastSiteList) && ctx.lastSiteList.length ? ctx.lastSiteList : (alarms.length ? alarms : planned)
  const fallback = selectedId || ctx.lastSiteId || list[0]
  let out = raw
  if (fallback) out = out.replace(/\b(that site|that one|same site|previous site)\b/ig, fallback)
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

function rememberReferenceContext(intent, inv, selectedId, text) {
  const ctx = readRefCtx()
  const next = { ...ctx }
  const mention = String(text || '').toUpperCase().match(/\bTOK_[A-Z0-9_]+\b/)
  if (mention?.[0]) next.lastSiteId = mention[0]
  if (selectedId) next.lastSiteId = selectedId
  if (intent?.select) next.lastSiteId = intent.select
  if (intent?.siteId) next.lastSiteId = intent.siteId
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

function findSite(inv, text) {
  const u = (text || '').toUpperCase()
  const hit = inv.sites.find((s) => u.includes(s.site_id))
  if (hit) return hit
  return inv.sites.find((s) => {
    const sarf = String(v(s.sarf_id) || '').toUpperCase()
    return sarf && u.includes(sarf)
  }) || null
}

function digest(inv, selectedId) {
  return {
    clock: inv.clock,
    selected: selectedId,
    counts: { sites: inv.sites.length, cells: inv.cells.length },
    sites: inv.sites.map((s) => ({
      id: s.site_id,
      status: v(s.status),
      type: v(s.site_type),
      alarm: !!s.in_alarm,
      sarf: v(s.sarf_id),
    })),
    alarms: inv.sites.filter((s) => s.in_alarm).map((s) => ({
      id: s.site_id,
      problems: (s.alarms || []).map((a) => a.problem),
    })),
    layers: {
      gh: nPts(inv.groundhog),
      dt: nPts(inv.drive_test),
      voc: nPts(inv.voc),
    },
  }
}

// A handful of local intents are greedy substring matches (a bare site id anywhere
// in the text, the phrase "in alarm" anywhere in the text). That's fine for short
// commands, but it hijacks genuine natural-language questions before they ever reach
// the LLM — "why might TOK_005 have coverage problems" would otherwise short-circuit
// to "Flew to TOK_005" without answering anything. Skip the greedy match instead and
// let it fall through to the LLM, which has the full digest and conversation memory.
const QUESTION_LIKE = /\b(why|how|what|when|where|which|who)\b|\?|\b(might|could|would|should|problem|issue|unusual|wrong)\b|^(is|does|was|are)\b|\bit\b/i

export function parseAsk(text, inv, selectedId) {
  const raw = (text || '').trim()
  const t = raw.toLowerCase()
  if (!t) return { type: 'empty' }
  const ctx = readRefCtx()
  const questionLike = QUESTION_LIKE.test(t)

  const siteFromText = findSite(inv, raw)
  const site = siteFromText || inv.sites.find((s) => s.site_id === selectedId)

  if (/last\s*3\s*sites|last three sites|recent 3 sites|recent three sites/.test(t)) {
    const alarms = inv.sites.filter((s) => s.in_alarm).map((s) => s.site_id)
    const planned = inv.sites.filter((s) => v(s.status) === 'planned').map((s) => s.site_id)
    const list = (Array.isArray(ctx.lastSiteList) && ctx.lastSiteList.length ? ctx.lastSiteList : (alarms.length ? alarms : planned)).slice(0, 3)
    if (!list.length) return { type: 'qa', narrate: 'No recent site list in context yet. Try: sites in alarm.' }
    return {
      type: 'qa',
      narrate: `Last 3 sites: ${list.join(', ')}. You can say "show neighbours for second one".`,
      siteList: list,
      select: list[0],
      fly: 'select',
    }
  }

  if (/\b3d\b|three.?d|terrain view/.test(t)) {
    const recipe = defaultRecipe()
    recipe.view = '3d'
    return { type: 'recipe', recipe, narrate: '3D on — terrain, buildings, beams at street zoom.', fly: 'cluster' }
  }
  if (/\b2d\b|plan view|flat map/.test(t)) {
    const recipe = defaultRecipe()
    recipe.view = '2d'
    return { type: 'recipe', recipe, narrate: 'Plan view. 3D off.', fly: 'cluster' }
  }

  if (/back to overview|exit section|clear section/.test(t)) {
    const recipe = defaultRecipe()
    return { type: 'recipe', recipe, section: null, narrate: 'Back to overview.', fly: 'cluster' }
  }

  if (/clear selection|deselect/.test(t)) {
    return { type: 'select', select: null, narrate: 'Selection cleared.' }
  }

  if (/^(clear|reset)\b/.test(t) || /on-air b3|clear to on-air/.test(t)) {
    const recipe = defaultRecipe()
    recipe.status = ['on-air']
    recipe.band = ['B3']
    return { type: 'recipe', recipe, narrate: 'Reset to on-air B3 macros.', fly: 'cluster' }
  }

  if (/\bplanned\b|coming soon/.test(t) && !/is this/.test(t)) {
    const recipe = defaultRecipe()
    recipe.status = ['planned']
    recipe.plannedLayer = true
    const n = inv.sites.filter((s) => v(s.status) === 'planned').length
    return { type: 'recipe', recipe, section: null, narrate: `${n} planned rooftops from the cell plan (siteType New) — gold rings. Not an ECGI-master coming-soon file.`, fly: 'planned' }
  }

  if (/daily drive|day drive|drive test|show drive|drive route|drive path/.test(t)) {
    const recipe = defaultRecipe()
    recipe.dtLayer = true
    recipe.ghLayer = false
    const routes = Number(inv.drive_test_paths?.n_routes || 0)
    const sid = site?.site_id || null
    return {
      type: 'recipe',
      recipe,
      section: 'dt',
      select: sid,
      narrate: sid
        ? `Daily drive test around ${sid}: ${routes.toLocaleString()} routes, ${nPts(inv.drive_test).toLocaleString()} points.`
        : `Daily drive test on: ${routes.toLocaleString()} routes, ${nPts(inv.drive_test).toLocaleString()} points.`,
      fly: sid ? 'dt-near' : 'dt-focus',
    }
  }

  if (/groundhog|heatmap|rsrp layer/.test(t)) {
    const recipe = defaultRecipe()
    recipe.ghLayer = true
    recipe.dtLayer = false
    return { type: 'recipe', recipe, section: 'gh', narrate: `Groundhog heatmap — ${nPts(inv.groundhog).toLocaleString()} samples.`, fly: 'gh' }
  }

  if (/\bholes?\b|coverage hole/.test(t)) {
    const recipe = defaultRecipe()
    recipe.holesLayer = true
    recipe.ghLayer = true
    recipe.dtLayer = false
    return { type: 'recipe', recipe, section: 'holes', narrate: 'Coverage holes from Groundhog RSRP ≤ −105 dBm.', fly: 'gh' }
  }

  if (/tier.?1|tier 1|show neighbou?rs?|neighbou?rs? for/.test(t)) {
    const sid = site?.site_id
    if (!sid) return { type: 'help', narrate: 'Name a site or select one first (e.g. "tier-1 neighbours for TOK_001"), or say "drop a new site" to pin a candidate rooftop.' }
    return { type: 'neighbors', siteId: sid, narrate: `Tier-1 facing neighbours for ${sid} — auto-proposed within 1.2 km, click a sector on the map to add or remove it.` }
  }

  if (/drop (a )?new site|place (a )?(candidate|new site)|pin (a )?(site|candidate)|new site here/.test(t)) {
    return { type: 'drop', narrate: 'Drop tool on — click the map to place a candidate rooftop. Facing sectors auto-propose. This is not an inventory site.' }
  }

  if (/export neighbou?r/.test(t)) {
    return { type: 'audit', format: /csv/.test(t) ? 'csv' : 'json', narrate: 'Exporting the monitored neighbour set and the add/remove trail.' }
  }

  if (/\bin alarm\b|macros in alarm|sites in alarm/.test(t) && !questionLike) {
    const recipe = defaultRecipe()
    recipe.inAlarm = true
    return { type: 'recipe', recipe, narrate: 'Sites in alarm — TOK_NEW_02 VSWR, TOK_NEW_05 fronthaul.', fly: 'alarms' }
  }

  if (/\bfailing sites?\b|\bfailed sites?\b|problem sites?|bad sites?|worst sites?/.test(t)) {
    const recipe = defaultRecipe()
    recipe.inAlarm = true
    return {
      type: 'recipe',
      recipe,
      section: null,
      narrate: 'Showing failing sites based on active alarms in this ingest.',
      fly: 'alarms',
    }
  }

  if (/\bfailing cells?\b|failed cells?|problem cells?|worst cells?/.test(t)) {
    const recipe = defaultRecipe()
    recipe.inAlarm = true
    recipe.sectorsLayer = true
    return {
      type: 'recipe',
      recipe,
      section: null,
      narrate: 'Showing sites with failing cells (alarm-linked) and sector view enabled.',
      fly: 'alarms',
    }
  }

  if (/facing east|point(?:ing)? east/.test(t)) {
    const recipe = defaultRecipe()
    recipe.azimuthRange = [45, 135]
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing east (45–135°). ${sid}.`, fly: 'select' }
  }
  if (/facing west/.test(t)) {
    const recipe = defaultRecipe()
    recipe.azimuthRange = [225, 315]
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing west. ${sid}.`, fly: 'select' }
  }
  if (/facing north/.test(t)) {
    const recipe = defaultRecipe()
    recipe.azimuthRange = [315, 45]
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing north. ${sid}.`, fly: 'select' }
  }
  if (/facing south/.test(t)) {
    const recipe = defaultRecipe()
    recipe.azimuthRange = [135, 225]
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing south. ${sid}.`, fly: 'select' }
  }

  if (/what alarm|alarms\??$|root cause/.test(t)) {
    return { type: 'qa', q: 'alarms', site, narrate: answerAlarms(site), select: site?.site_id, fly: site ? 'select' : null }
  }
  if (/\bems\b|which ems|ems\?/.test(t)) {
    return { type: 'qa', q: 'ems', site, narrate: site ? `EMS ${v(site.ems_server)} ← cell-plan.` : 'Select a site first, or name one (TOK_001).' }
  }
  if (/\bpci\b/.test(t) && (site || /sec\s*[123]/.test(t))) {
    return { type: 'qa', q: 'pci', site, narrate: answerPci(inv, site, t) }
  }
  if (/azimuth/.test(t) && site) {
    return { type: 'qa', q: 'az', site, narrate: answerAz(inv, site) }
  }
  if (/is this planned|planned\?/.test(t)) {
    return { type: 'qa', q: 'planned', site, narrate: site ? `${site.site_id} is ${v(site.status)} (${v(site.site_type_plan)} ← cell-plan).` : 'Select a site first.' }
  }
  if (/mmwave|5g sub-?6|\briud\b|\bdas\b|\bidsc\b|\bodsc\b/.test(t) && !/how many|sukayat/.test(t)) {
    return { type: 'qa', q: 'empty-enum', narrate: 'This TOK ingest is 4G B3 macro only. Those filters exist and show 0 — no rooftops invented for 5G, mmWave, RIUD, DAS, IDSC or ODSC.' }
  }
  if (/voc|complaint/.test(t)) {
    const total = nPts(inv.voc)
    const tokyo = Number(inv.voc?.tokyo_n || 0)
    if (!total) {
      return { type: 'qa', q: 'voc', narrate: 'No geocoded VOC loaded in this ingest.' }
    }
    return { type: 'qa', q: 'voc', narrate: `VOC loaded: ${total.toLocaleString()} geocoded rows (${tokyo.toLocaleString()} in Tokyo bounds).` }
  }
  if (/how many|sukayat|kanto|open 5g/.test(t)) {
    const sx = inv.sukayat_index || {}
    return { type: 'qa', q: 'index', narrate: `Sukayat Open+Kanto: ${sx.open_kanto ?? 0} (no coords). ${JSON.stringify(sx.by_tech || {})}.` }
  }

  if (siteFromText && !questionLike) {
    return { type: 'select', select: siteFromText.site_id, narrate: `Flew to ${siteFromText.site_id}.`, fly: 'select' }
  }

  return { type: 'help', narrate: 'Try: planned sites, sites in alarm, show drive test, show groundhog, or tier-1 neighbours for TOK_001.' }
}

export async function interpret(text, inv, selectedId) {
  const rawText = String(text || '')
  const resolvedText = resolveReferences(rawText, inv, selectedId)
  const low = rawText.toLowerCase()
  if (/\b(reset|clear)\b.*\b(memory|session|chat)\b|\bclear context\b/.test(low)) {
    try {
      const userId = getUserId()
      const res = await fetch('/api/chat/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ user_id: userId }),
      })
      if (res.ok) {
        const data = await res.json()
        return { type: 'qa', narrate: `Session memory reset for ${data.user_id}. Cleared ${Number(data.cleared || 0)} messages.` }
      }
      return { type: 'qa', narrate: 'Could not reset session memory right now.' }
    } catch {
      return { type: 'qa', narrate: 'Could not reset session memory right now.' }
    }
  }
  if (/\b(show|check|view)\b.*\b(memory|session|context)\b|\bmemory status\b/.test(low)) {
    try {
      const userId = getUserId()
      const res = await fetch(`/api/chat/memory?user_id=${encodeURIComponent(userId)}`, {
        method: 'GET',
        headers: { 'X-User-Id': userId },
      })
      if (res.ok) {
        const data = await res.json()
        return {
          type: 'qa',
          narrate: `Session memory for ${data.user_id}: ${Number(data.count || 0)} stored messages (cap ${Number(data.max_messages || 0)}).`,
        }
      }
      return { type: 'qa', narrate: 'Could not read session memory right now.' }
    } catch {
      return { type: 'qa', narrate: 'Could not read session memory right now.' }
    }
  }

  const local = parseAsk(resolvedText, inv, selectedId)
  if (local.type !== 'help') {
    rememberReferenceContext(local, inv, selectedId, resolvedText)
    return local
  }
  const headers = { 'Content-Type': 'application/json' }
  const key = getKey()
  if (key) headers['X-OpenAI-Key'] = key
  const claudeKey = getClaudeKey()
  if (claudeKey) headers['X-Anthropic-Key'] = claudeKey
  headers['X-User-Id'] = getUserId()

  const toIntent = (raw) => {
    const asText = String(raw || '').trim()
    if (!asText) return local
    const stripFence = asText.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
    const tryParse = (s) => {
      try { return JSON.parse(s) } catch { return null }
    }
    let intent = tryParse(stripFence)
    if (!intent) {
      const m = stripFence.match(/\{[\s\S]*\}/)
      if (m) intent = tryParse(m[0])
    }
    if (intent && typeof intent === 'object') {
      if (intent.recipe) intent.recipe = { ...defaultRecipe(), ...intent.recipe }
      if (!intent.type) intent.type = 'qa'
      if (!intent.narrate) intent.narrate = 'Done.'
      return intent
    }
    // If model returns plain text, still provide a useful response.
    return { type: 'qa', narrate: stripFence }
  }

  const d = digest(inv, selectedId)
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: getUserId(),
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You author a Tokyo RAN map. Reply JSON only:
{"type":"recipe"|"select"|"qa"|"neighbors"|"drop"|"audit"|"help","recipe":{},"select":null,"siteId":null,"fly":null,"narrate":""}
recipe keys (omit to leave default): tech[], band[], siteType[], status[], inAlarm bool|null, view "2d"|"3d", sectorsLayer, spiderLayer, ghLayer, dtLayer, holesLayer, plannedLayer, ghContourLayer, azimuthRange [lo,hi], pci string, onAirFrom, onAirTo.
fly: planned|alarms|select|dt|gh|cluster|null.
type "neighbors" shows Tier-1 facing neighbours for one inventory site — set siteId (required).
type "drop" arms the pin-drop tool for a candidate rooftop (not an inventory site).
type "audit" exports the current neighbour monitored set.
Use previous turns for follow-up context (pronouns, "that site", "same filter").
Use only site ids from the digest. Never invent rooftops, 5G, mmWave, RIUD or DAS cells. If VOC has 0 geocoded points, say so. narrate one short sentence.
Current digest JSON: ${JSON.stringify(d)}`,
          },
          { role: 'user', content: resolvedText },
        ],
      }),
    })
    if (res.status === 401 || !res.ok) {
      if (res.status === 429) return { type: 'qa', narrate: 'Copilot is rate-limited right now. Try again in a moment.' }
      return local
    }
    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content
    const intent = toIntent(raw)
    rememberReferenceContext(intent, inv, selectedId, resolvedText)
    return intent
  } catch {
    return local
  }
}

export async function interpretWithStream(text, inv, selectedId, onDelta) {
  const rawText = String(text || '')
  const resolvedText = resolveReferences(rawText, inv, selectedId)
  const low = rawText.toLowerCase()
  if (/\b(reset|clear)\b.*\b(memory|session|chat)\b|\bclear context\b/.test(low) || /\b(show|check|view)\b.*\b(memory|session|context)\b|\bmemory status\b/.test(low)) {
    const intent = await interpret(text, inv, selectedId)
    return { intent, streamed: false }
  }
  const local = parseAsk(resolvedText, inv, selectedId)
  if (local.type !== 'help') {
    rememberReferenceContext(local, inv, selectedId, resolvedText)
    return { intent: local, streamed: false }
  }

  const headers = { 'Content-Type': 'application/json' }
  const key = getKey()
  if (key) headers['X-OpenAI-Key'] = key
  const claudeKey = getClaudeKey()
  if (claudeKey) headers['X-Anthropic-Key'] = claudeKey
  const userId = getUserId()
  headers['X-User-Id'] = userId
  const d = digest(inv, selectedId)

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: userId,
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `You are Copilot for a Tokyo RAN GIS tool.
Answer in plain text only, concise and actionable. No JSON, no markdown table.
Use previous turns for follow-up context (pronouns, "that site", "same filter").
Never invent rooftop/site ids.
Current digest JSON: ${JSON.stringify(d)}`,
          },
          { role: 'user', content: resolvedText },
        ],
      }),
    })
    if (!res.ok || !res.body) return { intent: local, streamed: false }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    let streamDone = false
    while (!streamDone) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const chunks = buf.split('\n\n')
      buf = chunks.pop() || ''
      for (const block of chunks) {
        const line = block.split('\n').find((x) => x.startsWith('data: '))
        if (!line) continue
        const payload = line.slice(6).trim()
        if (!payload || payload === '[DONE]') continue
        let obj = null
        try { obj = JSON.parse(payload) } catch { obj = null }
        if (!obj) continue
        if (obj.delta) {
          full += String(obj.delta)
          if (onDelta) onDelta(String(obj.delta))
        }
        // obj.done only marks the server's logical end-of-message — the SSE
        // connection itself is never closed server-side, so waiting for the
        // reader to report done:true here hangs forever. Break the outer read
        // loop too, and release the connection instead of leaving it dangling.
        if (obj.done) { streamDone = true; break }
      }
    }
    if (streamDone) {
      try { await reader.cancel() } catch { /* */ }
    }
    // streamed must mean "the UI already showed this via onDelta" — if the
    // provider call failed or produced no content, full is empty and nothing
    // was ever appended to a bot message, so the caller needs to know that so
    // it narrates the fallback text itself instead of silently showing nothing.
    const gotContent = full.trim().length > 0
    const narrate = full.trim() || local.narrate || 'Try: planned sites, sites in alarm, show drive test, show groundhog, or tier-1 neighbours for TOK_001.'
    const intent = { type: 'qa', narrate }
    rememberReferenceContext(intent, inv, selectedId, resolvedText)
    return { intent, streamed: gotContent }
  } catch {
    return { intent: local, streamed: false }
  }
}

function answerAlarms(site) {
  if (!site) return 'Select a site — or say “macros in alarm”.'
  if (!site.alarms?.length) return `${site.site_id} has no active TOK FM alarms.`
  const root = site.alarms.find((a) => a.root_cause)
  const lines = site.alarms.map((a) => `${a.severity} ${a.problem}${a.root_cause ? ' ← root' : ''}`).join('; ')
  return `${site.site_id}: ${lines}. ${root ? `Root ${root.problem} ← tok-fm.` : ''}`
}

function answerPci(inv, site, t) {
  if (!site) return 'Select a site, or name one (TOK_001).'
  const m = t.match(/sec\s*([123])/)
  const cells = inv.cells.filter((c) => c.site_id === site.site_id)
  if (m) {
    const c = cells.find((x) => v(x.cell_name) === `Sec${m[1]}`)
    return c ? `PCI ${v(c.pci)} on ${c.cell_id} ← cell-plan.` : `No Sec${m[1]} on ${site.site_id}.`
  }
  return cells.map((c) => `${v(c.cell_name)} PCI ${v(c.pci)}`).join(' · ') + ' ← cell-plan.'
}

function answerAz(inv, site) {
  if (!site) return 'Select a site first.'
  return inv.cells.filter((c) => c.site_id === site.site_id)
    .map((c) => `${v(c.cell_name)} ${v(c.azimuth)}°`)
    .join(' · ') + ' ← antennaBearing cell-plan.'
}
