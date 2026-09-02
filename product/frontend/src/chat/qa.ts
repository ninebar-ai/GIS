import { v } from '../lobes'
import { nPts } from '../filters'

export function defaultCopilotFallback(inv) {
  const n = inv?.sites?.length ?? 0
  return `I only handle map commands for this Tokyo RAN ingest (${n} sites). Try: sites in alarm, show drive test, show groundhog, tier-1 neighbours for TOK_001, or ask "what can you do?".`
}

export function answerGeneralQuestion(text, inv) {
  const t = String(text || '').trim().toLowerCase()
  if (/^(?:hi|hello|hey|yo|good (?:morning|afternoon|evening))\b/.test(t)) {
    return 'Hi — I am Copilot on this Tokyo RAN map. Try: sites in alarm, show drive test, show groundhog, or tier-1 neighbours for TOK_001.'
  }
  if (/\bwhat can you do\b|\bhow can you help\b|\bwhat do you do\b|\bhelp me\b/.test(t)) {
    return 'I control this map: alarms, drive-test routes, Groundhog heatmap, coverage holes, planned sites, and tier-1 neighbour sectors. Example: tier-1 neighbours for TOK_003.'
  }
  if (/\bgis\b/.test(t)) {
    return 'GIS here is this interactive map workbench for Tokyo macro QA — site locations, sector beams, Groundhog RF samples, and drive-test traces. Say "show groundhog" or "show drive test" to explore layers.'
  }
  if (/\bgroundhog\b/.test(t) && /\b(?:what|explain|mean|is)\b/.test(t)) {
    return `Groundhog is a pre-loaded RF heatmap (${nPts(inv.groundhog).toLocaleString()} RSRP samples in this ingest). Say "show groundhog" to display it, or "coverage holes" for weak spots (≤ −105 dBm).`
  }
  if (/\bdrive test\b/.test(t) && /\b(?:what|explain|mean|is)\b/.test(t)) {
    const routes = Number(inv.drive_test_paths?.n_routes || 0)
    return `Drive test is field measurement data — ${routes} routes and ${nPts(inv.drive_test).toLocaleString()} points in this ingest. Say "daily drive test" to show routes on the map.`
  }
  if (/\b(?:tier.?1|neighbou?rs?)\b/.test(t) && /\b(?:what|explain|mean|is)\b/.test(t)) {
    return 'Tier-1 neighbours are facing sectors within 1.2 km that geometrically point toward a site — used for monitored neighbour sets. Example: tier-1 neighbours for TOK_001.'
  }
  if (/\bwhat is this\b|\bwhat am i looking at\b|\bthis tool\b|\bthis app\b|\bwhat is copilot\b/.test(t)) {
    const clock = inv?.clock?.ingest || 'demo'
    return `NS-QAW Tokyo ingest (${inv.sites.length} sites, ${clock}). I answer with map actions — not general web search. Try: sites in alarm, show drive test, tier-1 neighbours for TOK_001.`
  }
  return null
}

export function answerAlarms(site) {
  if (!site) return 'Select a site — or say “macros in alarm”.'
  if (!site.alarms?.length) return `${site.site_id} has no active TOK FM alarms.`
  const root = site.alarms.find((a) => a.root_cause)
  const lines = site.alarms.map((a) => `${a.severity} ${a.problem}${a.root_cause ? ' ← root' : ''}`).join('; ')
  return `${site.site_id}: ${lines}. ${root ? `Root ${root.problem} ← tok-fm.` : ''}`
}

export function answerPci(inv, site, t) {
  if (!site) return 'Select a site, or name one (TOK_001).'
  const m = t.match(/sec\s*([123])/)
  const cells = inv.cells.filter((c) => c.site_id === site.site_id)
  if (m) {
    const c = cells.find((x) => v(x.cell_name) === `Sec${m[1]}`)
    return c ? `PCI ${v(c.pci)} on ${c.cell_id} ← cell-plan.` : `No Sec${m[1]} on ${site.site_id}.`
  }
  return cells.map((c) => `${v(c.cell_name)} PCI ${v(c.pci)}`).join(' · ') + ' ← cell-plan.'
}

export function answerAz(inv, site) {
  if (!site) return 'Select a site first.'
  return inv.cells.filter((c) => c.site_id === site.site_id)
    .map((c) => `${v(c.cell_name)} ${v(c.azimuth)}°`)
    .join(' · ') + ' ← antennaBearing cell-plan.'
}
