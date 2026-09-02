import { v } from '../lobes'
import { nPts } from '../filters'

export function scopeEcho(inv, selectedId, section) {
  const parts = []
  if (selectedId) parts.push(selectedId)
  if (section) parts.push(section)
  if (inv?.clock?.t) parts.push(`ingest ${inv.clock.t}`)
  return parts.length ? parts.join(' · ') : 'overview'
}

/** Verbs for the Copilot rail — labels are what the engineer sees; ask is what parseAsk matches. */
export function contextChips({ section, selected, inv }: any = {}) {
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
export function digest(inv, selectedId, section = null) {
  return {
    clock: inv.clock,
    selected: selectedId,
    section,
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
