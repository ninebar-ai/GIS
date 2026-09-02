import { v } from '../lobes'
import { defaultRecipe, nPts } from '../filters'
import { formatNeighborNarrate } from '../neighbors'
import { readRefCtx, contextSite, resolveSiteToken } from './memory'
import { scopeEcho } from './digest'
import { defaultCopilotFallback, answerAlarms, answerPci, answerAz } from './qa'

export function normalizeAskText(text) {
  return String(text || '').trim().replace(
    /^(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:(?:show|find|list|get|give|display|highlight)\s+(?:me|us)\s+(?:the\s+)?(?:(?:all|any)\s+)?)/i,
    '',
  ).trim()
}

function findSite(inv, text) {
  const u = (text || '').toUpperCase()
  let hit = inv.sites.find((s) => u.includes(s.site_id))
  if (hit) return hit
  hit = inv.sites.find((s) => {
    const sarf = String(v(s.sarf_id) || '').toUpperCase()
    return sarf && u.includes(sarf)
  })
  if (hit) return hit
  const near = u.match(/\b(?:NEAR|AROUND|CLOSE TO)\s+(?:TOK_?)?([A-Z0-9_]+)\b/)
  if (near?.[1] && !/\bNEIGHBOU?RS?\b/.test(u)) return resolveSiteToken(inv, near[1])
  const tok = u.match(/\bTOK_([A-Z0-9_]+)\b/)
  if (tok?.[1]) return resolveSiteToken(inv, tok[1])
  const num = u.match(/\b(?:SITE|SITES|NEAR|AROUND)\s+(?:TOK_?)?(\d{2,})\b/)
  if (num?.[1]) return resolveSiteToken(inv, num[1])
  return null
}

// Sparse on purpose: a recipe intent is a PATCH over current map state, so a
// rule names only the keys it actually means. Returning defaultRecipe() here
// silently reset every unrelated filter the user had set.
function alarmSitesRecipe() {
  return { inAlarm: true, sectorsLayer: true, plannedLayer: true }
}

/** The layer vocabulary, in the order a person is likely to say it. */
const LAYER_WORDS = [
  { key: 'holesLayer', label: 'coverage holes', re: /\bholes?\b|coverage hole/ },
  { key: 'plannedLayer', label: 'planned sites', re: /\bplanned\b|coming soon/ },
  { key: 'ghLayer', label: 'groundhog', re: /groundhog|heatmap|rsrp layer/ },
  { key: 'dtLayer', label: 'drive test', re: /drive test|drive route|drive path|daily drive/ },
  { key: 'ghContourLayer', label: 'contours', re: /contour|isoband/ },
  { key: 'sectorsLayer', label: 'sector lobes', re: /\bsector lobes?\b|\blobes?\b/ },
  { key: 'spiderLayer', label: 'co-site spider', re: /\bspider\b|co-?site line/ },
]

/**
 * "turn on holes and planned together" names two layers; the single-layer rules
 * below can only return one. Build one patch covering every layer mentioned.
 * Returns null unless at least two matched, so single-layer phrasings keep their
 * existing richer narration (counts, section, camera move).
 */
function multiLayerIntent(t) {
  const hits = LAYER_WORDS.filter((l) => l.re.test(t))
  if (hits.length < 2) return null
  const off = /\b(turn off|switch off|hide|remove|disable|drop|without|no more)\b/.test(t)
  const recipe: Record<string, boolean> = {}
  for (const h of hits) recipe[h.key] = !off
  // Coverage holes are derived from Groundhog samples — showing them without it
  // would draw rings over an empty basemap.
  if (recipe.holesLayer === true) recipe.ghLayer = true
  const names = hits.map((h) => h.label)
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
  return {
    type: 'recipe',
    recipe,
    narrate: `${off ? 'Hid' : 'Showing'} ${list}.`,
    fly: null,
  }
}

function isAlarmSitesListQuery(t) {
  if (/\b(?:what|which|any|how many|list|show|find|tell me)\b.*\bsites?\b.*\b(?:fail(?:ure|ing|ed)?|alarm(?:s|ed|ing)?|fault(?:y|ed)?|problem)\b/i.test(t)) return true
  if (/\bsites?\b.*\b(?:that|which|are|with|having)\b.*\b(?:fail(?:ure|ing|ed)?|alarm|fault(?:y|ed)?|problem)\b/i.test(t)) return true
  if (/\b(?:fail(?:ure|ing|ed)|problem|bad|worst|fault(?:y|ed)?)\s+sites?\b/i.test(t)) return true
  if (/\bsites?\s+(?:in\s+)?(?:fail(?:ure|ing|ed)|alarm)\b/i.test(t)) return true
  if (/\bsites?\s+(?:with|having)\s+alarms?\b/i.test(t)) return true
  if (/\bin\s+alarm\b|\bmacros in alarm\b|\bsites in alarm\b/i.test(t)) return true
  return false
}

function alarmSitesIntent(inv, t) {
  const recipe = alarmSitesRecipe()
  const alarmSites = inv.sites.filter((s) => s.in_alarm)
  const ids = alarmSites.map((s) => s.site_id)
  const isQuestion = /\b(what|which|how many|any)\b/i.test(t)
  let narrate
  if (!ids.length) {
    narrate = 'No sites in alarm in this ingest.'
  } else if (isQuestion) {
    const detail = alarmSites.map((s) => {
      const probs = (s.alarms || []).map((a) => a.problem).filter(Boolean)
      return probs.length ? `${s.site_id} (${probs.join(', ')})` : s.site_id
    }).join('; ')
    narrate = `${ids.length} site${ids.length === 1 ? '' : 's'} in alarm: ${detail}.`
  } else {
    narrate = `Showing ${ids.length} site${ids.length === 1 ? '' : 's'} in alarm: ${ids.join(', ')}.`
  }
  return {
    type: 'recipe',
    recipe,
    section: null,
    select: ids[0] || null,
    narrate,
    fly: ids.length ? 'alarms' : 'cluster',
  }
}
// A handful of local intents are greedy substring matches (a bare site id anywhere
// in the text, the phrase "in alarm" anywhere in the text). That's fine for short
// commands, but it hijacks genuine natural-language questions before they ever reach
// the LLM — "why might TOK_005 have coverage problems" would otherwise short-circuit
// to "Flew to TOK_005" without answering anything. Skip the greedy match instead and
// let it fall through to the LLM, which has the full digest and conversation memory.
export const QUESTION_LIKE = /\b(why|how|what|when|where|which|who)\b|\?|\b(might|could|would|should|problem|issue|unusual|wrong)\b|^(is|does|was|are)\b|\bit\b/i

/**
 * Should this turn go to the model?
 *
 * This is only ever asked after parseAsk() has already declined (tier 2 returns
 * anything but 'help' and we never get here) and after the canned FAQ missed. So
 * the deterministic path has had its chance, and anything still standing is
 * exactly what the model is for — including map commands.
 *
 * This used to reject every map verb (show/list/filter/tier-1/neighbours/drive
 * test/groundhog/planned/alarm/coverage hole) and to require a question word,
 * which made the whole recipe|select|neighbors|drop|audit half of the schema
 * unreachable and answered "turn on holes and planned together" with canned help.
 */
export function shouldAskModel(t) {
  const s = String(t || '').trim().toLowerCase()
  if (!s) return false
  // Greetings are cheap to answer and shouldn't look like a parse failure.
  if (/^(?:hi|hello|hey|yo|thanks|thank you|good (?:morning|afternoon|evening))\b/.test(s)) return true
  // Handled deterministically elsewhere; don't pay for a model call.
  if (isAlarmSitesListQuery(s)) return false
  return true
}

export function withScopeNarrate(intent, inv, selectedId, section) {
  if (!intent?.narrate || intent.type === 'empty') return intent
  const scopeSelected =
    intent.type === 'neighbors' && intent.siteId ? intent.siteId
      : intent.type === 'select' && intent.select ? intent.select
        : intent.select || selectedId
  const scopeSection =
    intent.type === 'neighbors' ? 'neighbors'
      : intent.section !== undefined ? intent.section
        : section
  const scope = scopeEcho(inv, scopeSelected, scopeSection)
  if (scope === 'overview') return intent
  return { ...intent, narrate: `${intent.narrate} [${scope}]` }
}

export function parseAsk(text, inv, selectedId) {
  const raw = normalizeAskText(text)
  const t = raw.toLowerCase()
  if (!t) return { type: 'empty' }
  const ctx = readRefCtx()
  const questionLike = QUESTION_LIKE.test(t) && !/\b(show|list|find|highlight|filter)\b/.test(t) && !/^[?！？]+$/.test(t)

  if (/^[?！？]+$/.test(t) || /^(?:huh|what|what\?|and\s+now|now\?)$/i.test(t)) {
    const sid = contextSite(ctx, selectedId, inv)
    if (ctx.lastCommand === 'neighbors' && sid) {
      return { type: 'neighbors', siteId: sid, narrate: formatNeighborNarrate(inv, sid) }
    }
    return {
      type: 'qa',
      narrate: sid
        ? `Last focus: ${sid}${ctx.lastCommand ? ` (${ctx.lastCommand})` : ''}. Try: tier-1 neighbours for ${sid}, daily drive test near ${sid}, or sites in alarm.`
        : 'Try: sites in alarm, show drive test, tier-1 neighbours for TOK_001, or neighbours of 002.',
    }
  }

  const siteFromText = findSite(inv, raw)
  const site = siteFromText || inv.sites.find((s) => s.site_id === selectedId)

  if (isAlarmSitesListQuery(t)) {
    return alarmSitesIntent(inv, t)
  }

  const neighborNear = t.match(/\bneighbou?rs?\s+(?:near|around|for|of|at)\s+(?:tok[-_\s]?)?([a-z0-9_]+)\b/i)
  if (neighborNear?.[1]) {
    const nearSite = resolveSiteToken(inv, neighborNear[1])
    if (nearSite) {
      return {
        type: 'neighbors',
        siteId: nearSite.site_id,
        narrate: formatNeighborNarrate(inv, nearSite.site_id),
      }
    }
  }

  const nearRef = t.match(/\b(?:sites?\s+)?(?:near|around|close to)\s+(?:tok[-_\s]?)?([a-z0-9_]+)\b/i)
  if (nearRef?.[1] && !/tier.?1|tier 1|neighbou?rs?/.test(t)) {
    const nearSite = resolveSiteToken(inv, nearRef[1])
    if (nearSite) {
      return {
        type: 'select',
        select: nearSite.site_id,
        narrate: `Flew to ${nearSite.site_id}. Say "tier-1 neighbours for ${nearSite.site_id}" for facing sectors within 1.2 km.`,
        fly: 'select',
      }
    }
  }

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
    const recipe = { view: '3d' }
    return { type: 'recipe', recipe, narrate: '3D on — terrain, buildings, beams at street zoom.', fly: 'cluster' }
  }
  if (/\b2d\b|plan view|flat map/.test(t)) {
    const recipe = { view: '2d' }
    return { type: 'recipe', recipe, narrate: 'Plan view. 3D off.', fly: 'cluster' }
  }

  if (/back to overview|exit section|clear section/.test(t)) {
    const recipe = defaultRecipe()
    return { type: 'recipe', recipe, reset: true, section: null, narrate: 'Back to overview.', fly: 'cluster' }
  }

  if (/clear selection|deselect/.test(t)) {
    return { type: 'select', select: null, narrate: 'Selection cleared.' }
  }

  if (/^(clear|reset)\b/.test(t) || /on-air b3|clear to on-air/.test(t)) {
    const recipe = defaultRecipe()
    recipe.status = ['on-air']
    recipe.band = ['B3']
    return { type: 'recipe', recipe, reset: true, narrate: 'Reset to on-air B3 macros.', fly: 'cluster' }
  }

  // Compose before matching single layers. The rules below are ordered, so the
  // first one to mention a layer used to win outright: "turn on holes and
  // planned together" hit the planned rule and silently dropped holes. When more
  // than one layer is named in the same breath, honour all of them.
  const multi = multiLayerIntent(t)
  if (multi) return multi

  if (/\bplanned\b|coming soon/.test(t) && !/is this/.test(t)) {
    const recipe = { status: ['planned'], plannedLayer: true }
    const n = inv.sites.filter((s) => v(s.status) === 'planned').length
    return { type: 'recipe', recipe, section: null, narrate: `${n} planned rooftops from the cell plan (siteType New) — gold rings. Not an ECGI-master coming-soon file.`, fly: 'planned' }
  }

  if (/daily drive|day drive|drive test|show drive|drive route|drive path/.test(t)) {
    const recipe = { dtLayer: true, ghLayer: false }
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
    const recipe = { ghLayer: true, dtLayer: false }
    return { type: 'recipe', recipe, section: 'gh', narrate: `Groundhog heatmap — ${nPts(inv.groundhog).toLocaleString()} samples.`, fly: 'gh' }
  }

  if (/\bholes?\b|coverage hole/.test(t)) {
    const recipe = { holesLayer: true, ghLayer: true, dtLayer: false }
    return { type: 'recipe', recipe, section: 'holes', narrate: 'Coverage holes from Groundhog RSRP ≤ −105 dBm.', fly: 'gh' }
  }

  if (/tier.?1|tier 1|show neighbou?rs?|neighbou?rs?\s+(?:for|near|around|of)|(?:its?|their)\s+neighbou?rs?/.test(t)) {
    const sid = siteFromText?.site_id || contextSite(ctx, selectedId, inv)
    if (!sid) return { type: 'help', narrate: 'Name a site or select one first (e.g. "tier-1 neighbours for TOK_001"), or say "drop a new site" to pin a candidate rooftop.' }
    return { type: 'neighbors', siteId: sid, narrate: formatNeighborNarrate(inv, sid) }
  }

  if (/drop (a )?new site|place (a )?(candidate|new site)|pin (a )?(site|candidate)|new site here/.test(t)) {
    return { type: 'drop', narrate: 'Drop tool on — click the map to place a candidate rooftop. Facing sectors auto-propose. This is not an inventory site.' }
  }

  if (/export neighbou?r/.test(t)) {
    return { type: 'audit', format: /csv/.test(t) ? 'csv' : 'json', narrate: 'Exporting the monitored neighbour set and the add/remove trail.' }
  }

  if (/\bfailing cells?\b|failed cells?|problem cells?|worst cells?\b/.test(t)) {
    const recipe = { inAlarm: true, sectorsLayer: true }
    return {
      type: 'recipe',
      recipe,
      section: null,
      narrate: 'Showing sites with failing cells (alarm-linked) and sector view enabled.',
      fly: 'alarms',
    }
  }

  if (/facing east|point(?:ing)? east/.test(t)) {
    const recipe = { azimuthRange: [45, 135] }
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing east (45–135°). ${sid}.`, fly: 'select' }
  }
  if (/facing west/.test(t)) {
    const recipe = { azimuthRange: [225, 315] }
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing west. ${sid}.`, fly: 'select' }
  }
  if (/facing north/.test(t)) {
    const recipe = { azimuthRange: [315, 45] }
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing north. ${sid}.`, fly: 'select' }
  }
  if (/facing south/.test(t)) {
    const recipe = { azimuthRange: [135, 225] }
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing south. ${sid}.`, fly: 'select' }
  }

  if (/what alarms?\s+(?:on|at|for)\b|root cause/i.test(t) || /^alarms?\??$/i.test(t.trim())) {
    const alarmSite = siteFromText || site
    return { type: 'qa', q: 'alarms', site: alarmSite, narrate: answerAlarms(alarmSite), select: alarmSite?.site_id, fly: alarmSite ? 'select' : null }
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

  return { type: 'help', narrate: defaultCopilotFallback(inv) }
}
