import { v } from './lobes'

export const EMPTY_REASON = {
  '5G Sub-6': '0 in this ingest — TOK cluster is 4G macro B3',
  mmWave: '0 in this ingest — TOK cluster is 4G macro B3',
  RIUD: '0 rooftops — ingest is MACRO only',
  dash: '0 rooftops — ingest is MACRO only',
  IDSC: '0 rooftops — ingest is MACRO only',
  ODSC: '0 rooftops — ingest is MACRO only',
  DAS: '0 rooftops — ingest is MACRO only',
  VOC: '0 geocoded complaints in current ingest',
}

/** Layer/filter spec keys the Copilot may patch — validated before paint. */
export const RECIPE_LAYER_KEYS = [
  'sectorsLayer', 'spiderLayer', 'ghLayer', 'dtLayer', 'holesLayer',
  'ghContourLayer', 'vocLayer', 'plannedLayer',
]
export const RECIPE_ARRAY_KEYS = ['tech', 'band', 'siteType', 'status', 'morphology', 'carrier']

export function defaultRecipe() {
  return {
    tech: [],
    band: [],
    siteType: [],
    status: [],
    morphology: [],
    carrier: [],
    inAlarm: null,
    serviceAffecting: null,
    view: '2d',
    sectorsLayer: true,
    spiderLayer: true,
    ghLayer: false,
    dtLayer: false,
    holesLayer: false,
    ghContourLayer: false,
    vocLayer: false,
    plannedLayer: true,
    pci: '',
    onAirFrom: '',
    onAirTo: '',
    height: [null, null],
    mechTilt: [null, null],
    hasCmAzimuth: true,
    azimuthRange: null,
    identity: '',
  }
}

function enumKeyForRecipe(key) {
  if (key === 'siteType') return 'site_type'
  return key
}

/** Validate a layer spec against inventory enums before the map runs it. */
export function sanitizeRecipe(recipe, inv) {
  const base = defaultRecipe()
  const src = recipe && typeof recipe === 'object' ? recipe : {}
  const next = { ...base, ...src }
  const enums = inv?.enums || {}
  for (const key of RECIPE_ARRAY_KEYS) {
    const ek = enumKeyForRecipe(key)
    const allowed = enums[ek]
    const arr = Array.isArray(next[key]) ? next[key] : []
    next[key] = allowed?.length ? arr.filter((x) => allowed.includes(x)) : arr
  }
  next.view = next.view === '3d' ? '3d' : '2d'
  if (next.inAlarm === true || next.inAlarm === 'true') next.inAlarm = true
  else if (next.inAlarm === false || next.inAlarm === 'false') next.inAlarm = false
  else next.inAlarm = null
  if (next.serviceAffecting != null) next.serviceAffecting = next.serviceAffecting === true ? true : null
  if (next.azimuthRange) {
    const ok = Array.isArray(next.azimuthRange) && next.azimuthRange.length === 2
      && next.azimuthRange.every((n) => Number.isFinite(Number(n)))
    if (!ok) next.azimuthRange = null
    else {
      const deg = (n) => ((Number(n) % 360) + 360) % 360
      let [a, b] = [deg(next.azimuthRange[0]), deg(next.azimuthRange[1])]
      // "facing 200 degrees" is a bearing, not a window. A zero-width range
      // matches no cell and silently empties the map, so open it to ±25°.
      const width = a <= b ? b - a : 360 - a + b
      if (width < 1) { a = deg(a - 25); b = deg(b + 25) }
      next.azimuthRange = [a, b]
    }
  }
  for (const key of RECIPE_LAYER_KEYS) {
    if (typeof next[key] !== 'boolean') next[key] = base[key]
  }
  if (typeof next.pci !== 'string') next.pci = String(next.pci ?? '')
  if (!Array.isArray(next.height) || next.height.length !== 2) next.height = [null, null]
  if (!Array.isArray(next.mechTilt) || next.mechTilt.length !== 2) next.mechTilt = [null, null]
  return next
}

export function cellMatch(c, site, r) {
  if (r.hasCmAzimuth === true && c.has_cm_azimuth === false) return false
  if (r.tech.length && !r.tech.includes(v(c.tech))) return false
  if (r.band.length && !r.band.includes(v(c.band))) return false
  if (r.siteType.length && !r.siteType.includes(v(c.site_type))) return false
  if (r.carrier?.length && !r.carrier.includes(String(v(c.carrier)))) return false
  if (r.status.length && !r.status.includes(v(c.status))) return false
  if (r.morphology.length && !r.morphology.includes(v(site.morphology))) return false
  if (r.inAlarm === true && !c.in_alarm && !site.in_alarm) return false
  if (r.inAlarm === false && (c.in_alarm || site.in_alarm)) return false
  if (r.serviceAffecting === true && !site.alarm_summary?.service_affecting) return false
  if (r.pci !== '' && Number(r.pci) !== Number(v(c.pci))) return false
  const h = v(c.height_m)
  if (r.height[0] != null && h != null && h < r.height[0]) return false
  if (r.height[1] != null && h != null && h > r.height[1]) return false
  const t = v(c.mech_tilt)
  if (r.mechTilt[0] != null && t != null && t < r.mechTilt[0]) return false
  if (r.mechTilt[1] != null && t != null && t > r.mechTilt[1]) return false
  if (r.azimuthRange) {
    const [a, b] = r.azimuthRange
    const az = ((v(c.azimuth) % 360) + 360) % 360
    if (a <= b) {
      if (az < a || az > b) return false
    } else if (!(az >= a || az <= b)) return false
  }
  if (r.identity) {
    const q = r.identity.toLowerCase()
    const blob = [c.cell_id, v(c.ecgi), v(c.sarf_id), v(c.cell_name), site.site_id, v(site.enb_name), v(site.ems_server)]
      .join(' ').toLowerCase()
    if (!blob.includes(q)) return false
  }
  if (r.onAirFrom || r.onAirTo) {
    const d = v(site.on_air_date)
    if (!d) return false
    if (r.onAirFrom && d < r.onAirFrom) return false
    if (r.onAirTo && d > r.onAirTo) return false
  }
  return true
}

export function applyRecipe(inv, r) {
  const siteBy = Object.fromEntries(inv.sites.map((s) => [s.site_id, s]))
  const cells = inv.cells.filter((c) => cellMatch(c, siteBy[c.site_id], r))
  const ids = new Set(cells.map((c) => c.site_id))
  const sites = inv.sites.filter((s) => ids.has(s.site_id))
  return { sites, cells }
}

export function nPts(layer) {
  if (!layer) return 0
  if (typeof layer.n === 'number') return layer.n
  if (Array.isArray(layer)) return layer.length
  return 0
}

export function counts(inv, r) {
  const { sites, cells } = applyRecipe(inv, r)
  return {
    sites: sites.length,
    cells: cells.length,
    alarm: sites.filter((s) => s.in_alarm).length,
    planned: sites.filter((s) => v(s.status) === 'planned').length,
    gh: nPts(inv.groundhog),
    dt: nPts(inv.drive_test),
  }
}

export function chipList(r) {
  const chips = []
  for (const t of r.tech) chips.push({ key: 'tech', value: t, label: t })
  for (const t of r.band) chips.push({ key: 'band', value: t, label: t })
  for (const t of r.siteType) chips.push({ key: 'siteType', value: t, label: t })
  for (const t of r.carrier || []) chips.push({ key: 'carrier', value: t, label: `EARFCN ${t}` })
  for (const t of r.status) chips.push({ key: 'status', value: t, label: t })
  for (const t of r.morphology) chips.push({ key: 'morphology', value: t, label: t })
  if (r.inAlarm === true) chips.push({ key: 'inAlarm', value: true, label: 'in alarm' })
  if (r.serviceAffecting === true) chips.push({ key: 'sa', value: true, label: 'service affecting' })
  if (r.pci) chips.push({ key: 'pci', value: r.pci, label: `PCI ${r.pci}` })
  if (r.azimuthRange) chips.push({ key: 'az', value: r.azimuthRange, label: `az ${r.azimuthRange[0]}–${r.azimuthRange[1]}` })
  if (r.identity) chips.push({ key: 'identity', value: r.identity, label: r.identity })
  if (r.onAirFrom) chips.push({ key: 'onAirFrom', value: r.onAirFrom, label: `on-air ≥ ${r.onAirFrom}` })
  if (r.onAirTo) chips.push({ key: 'onAirTo', value: r.onAirTo, label: `on-air ≤ ${r.onAirTo}` })
  if (r.plannedLayer === false) chips.push({ key: 'plannedLayer', value: false, label: 'planned rings off' })
  return chips
}

export function dismissChip(r, chip) {
  const next = { ...r }
  if (['tech', 'band', 'siteType', 'status', 'morphology', 'carrier'].includes(chip.key)) {
    next[chip.key] = r[chip.key].filter((x) => x !== chip.value)
  } else if (chip.key === 'inAlarm') next.inAlarm = null
  else if (chip.key === 'sa') next.serviceAffecting = null
  else if (chip.key === 'pci') next.pci = ''
  else if (chip.key === 'az') next.azimuthRange = null
  else if (chip.key === 'identity') next.identity = ''
  else if (chip.key === 'onAirFrom') next.onAirFrom = ''
  else if (chip.key === 'onAirTo') next.onAirTo = ''
  else if (chip.key === 'plannedLayer') next.plannedLayer = true
  return next
}

export function toggleRecipePill(recipe, key, val) {
  const next = { ...recipe }
  if (key === 'inAlarm') next.inAlarm = recipe.inAlarm === true ? null : true
  else if (key === 'sa') next.serviceAffecting = recipe.serviceAffecting === true ? null : true
  else {
    const arr = [...(recipe[key] || [])]
    const i = arr.indexOf(val)
    if (i >= 0) arr.splice(i, 1)
    else arr.push(val)
    next[key] = arr
  }
  return next
}

export function setRecipeLayer(recipe, key, on) {
  return { ...recipe, [key]: on }
}
