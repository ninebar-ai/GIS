/**
 * The one door to published data.
 *
 * Two sources behind one interface: the geo-api / PostGIS path when it is up
 * (bbox-scoped inventory, MVT for the dense layers) and the published file
 * artifacts otherwise. The prototype has to keep running with no database, so
 * the files stay a first-class fallback rather than a dead branch.
 *
 * Rule for anything added here: no caller may assume the whole inventory is
 * resident. It is today; it will not be at production volumes.
 */
import { loadPacked } from './heavy'

const EMPTY_FC = { type: 'FeatureCollection', features: [] }

/** serve.py proxies /geo/* to geo-api and attaches the tenant server-side. */
const GEO = '/geo'

/** Where the backend mounts db/published/ — the offline ingest output. */
const PUBLISHED = '/published'

export const source = { inventory: 'files', tiles: false, reason: '' }

async function geoJson(path, { timeoutMs = 6000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${GEO}${path}`, { signal: ctrl.signal })
    if (!res.ok) {
      // serve.py answers 503 with {"error": ...} when geo-api is down; pass the
      // reason back rather than a bare null so the UI can say what happened.
      try { return { ...(await res.json()), ok: false } } catch { return null }
    }
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Is the PostGIS path actually serving?
 *
 * Retried, because a single timed-out probe used to downgrade the whole session
 * to files silently — one slow moment at boot and you lost tiles with nothing on
 * screen saying why. Two attempts, and the reason is surfaced in the HUD.
 */
export async function probeGeoApi({ attempts = 2 } = {}) {
  let lastReason = 'geo-api did not answer'
  for (let i = 0; i < attempts; i++) {
    const body = await geoJson('/inventory?limit=1', { timeoutMs: 4000 + i * 4000 })
    if (body?.ok) {
      source.inventory = 'geo-api'
      source.tiles = true
      source.reason = ''
      return true
    }
    if (body && body.error) lastReason = String(body.error)
    if (i + 1 < attempts) await new Promise((r) => setTimeout(r, 400))
  }
  source.inventory = 'files'
  source.tiles = false
  source.reason = `${lastReason} — serving published files`
  return false
}

/**
 * Cells as published-shaped records.
 *
 * geo-api returns one envelope per response with plain GeoJSON properties, while
 * inventory.json wraps every field as {value, source, measuredAt}. lobes.js v()
 * unwraps either, so plain values pass through untouched — no shim needed.
 */
function cellsFromFeatures(features) {
  return (features || []).map((f) => {
    const p = f.properties || {}
    const [lng, lat] = f.geometry?.coordinates || []
    return {
      cell_id: p.cell_id || p.id,
      site_id: p.site_id,
      lng, lat,
      azimuth: p.azimuth,
      hpbw: p.beamwidth ?? p.hpbw,
      band: p.band,
      pci: p.pci,
      tech: p.tech,
      status: p.status || 'on-air',
      height_m: p.height_m,
      mech_tilt: p.tilt,
      elec_tilt: p.electrical_tilt,
      has_cm_azimuth: p.azimuth != null,
      in_alarm: false,
    }
  })
}

export async function loadInventory() {
  const res = await fetch(`${PUBLISHED}/inventory.json`)
  if (!res.ok) throw new Error(`inventory.json ${res.status}`)
  const inv = await res.json()
  await probeGeoApi()
  return inv
}

/**
 * Cells inside the current view, from PostGIS. Returns null when the API is not
 * serving, so the caller keeps whatever it already has rather than blanking the
 * map on a transient failure.
 */
export async function loadCellsInView(bounds, { limit = 3000 } = {}) {
  if (!source.tiles || !bounds) return null
  const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
    .map((n) => n.toFixed(5)).join(',')
  const body = await geoJson(`/inventory?bbox=${bbox}&limit=${limit}`)
  if (!body?.ok || !body.data?.features) return null
  return cellsFromFeatures(body.data.features)
}

/** Packed f32le triplets — the fallback measurement path when tiles are off. */
export async function loadHeavy(inv) {
  const [gh, dt] = await Promise.all([
    loadPacked(`${PUBLISHED}/${inv?.groundhog?.file || 'gh.bin'}`),
    loadPacked(`${PUBLISHED}/${inv?.drive_test?.file || 'dt.bin'}`),
  ])
  return { gh, dt }
}

export async function loadDtPaths(inv) {
  const file = inv?.drive_test_paths?.file
  if (!file) return EMPTY_FC
  try {
    const res = await fetch(`${PUBLISHED}/${file}`)
    return res.ok ? await res.json() : EMPTY_FC
  } catch {
    return EMPTY_FC
  }
}

/** MVT template URLs for the dense layers; null when the tile path is unavailable. */
export function tileUrls() {
  if (!source.tiles) return null
  return {
    gh: `${location.origin}${GEO}/tiles/measurement/gh/{z}/{x}/{y}.mvt`,
    dt: `${location.origin}${GEO}/tiles/measurement/dt/{z}/{x}/{y}.mvt`,
    route: `${location.origin}${GEO}/tiles/route/{z}/{x}/{y}.mvt`,
  }
}
