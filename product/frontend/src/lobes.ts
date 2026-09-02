/** Mapsheet Zero lobe geometry — Gaussian −3 dB contour, not a pie. */

export function v(field) {
  if (field && typeof field === 'object' && 'value' in field) return field.value
  return field
}

/**
 * Gaussian main lobe. Dividing by the full HPBW puts −3 dB at ±HPBW/2, which is
 * what the −3 dB contour means and what neighbors.js already tests against
 * (angDiff > hpbw / 2). Dividing by hpbwRad/2 drew the contour at ±HPBW/4 and
 * turned every sector into a 3.75:1 needle.
 */
export function gain(rel, hpbwRad) {
  const a = Math.exp(-2.773 * (rel / hpbwRad) ** 2)
  const back = 0.085 * Math.exp(-2.0 * ((Math.abs(rel) - Math.PI) / 1.1) ** 2)
  return Math.max(a, back, 0.02)
}

function wrapPi(rel) {
  while (rel > Math.PI) rel -= Math.PI * 2
  while (rel < -Math.PI) rel += Math.PI * 2
  return rel
}

/** Radial band-offset stacking: same rooftop, different bands walk out along the beam. */
export function offsetOrigin(lng, lat, azimuthDeg, { index = 0, band = 'B3' } = {}) {
  const bandRank = { B1: 0, B3: 1, B7: 2, B8: 3, B28: 4, n78: 5 }
  const radialM = 8 + (bandRank[band] ?? 1) * 6
  const lateralM = index * 3.2
  const az = (azimuthDeg * Math.PI) / 180
  const mLat = 1 / 110540
  const mLng = 1 / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2))
  const dN = radialM * Math.cos(az) - lateralM * Math.sin(az)
  const dE = radialM * Math.sin(az) + lateralM * Math.cos(az)
  return [lng + dE * mLng, lat + dN * mLat]
}

/** On-screen lobe length in CSS pixels. The one knob for sector size. */
export const LOBE_PX = 72

/** 3D beam extrusion height, metres. Constant so extrusions match the 2D lobes. */
export const BEAM_HEIGHT_M = 90

/** Ground metres per pixel at zoom 0, lat 0. MapLibre tiles are 512 px: 40075016.686 / 512. */
const M_PER_PX_Z0 = 78271.5170

/**
 * Every lobe the same size on screen, at every zoom.
 *
 * Reach used to be h / tan(tilt), which across this ingest spans 366–1088 m —
 * driven almost entirely by elec_tilt, since mech_tilt and hpbw are constant.
 * That made sectors look like scattered fireflies rather than one instrument.
 * Tilt and height stay on the site card; they no longer drive geometry.
 *
 * Returns latitude degrees — lobePolygon divides the longitude component by cos(lat).
 */
export function screenReachDeg(lat, zoom) {
  const mPerPx = (M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
  return (LOBE_PX * mPerPx) / 111320
}

export function lobePolygon(lng, lat, azimuthDeg, hpbwDeg, reachDeg) {
  const az = (azimuthDeg * Math.PI) / 180
  const hpbw = (hpbwDeg * Math.PI) / 180
  const ring = []
  const n = 72
  for (let i = 0; i <= n; i++) {
    const th = az - Math.PI + (i / n) * Math.PI * 2
    const rel = wrapPi(th - az)
    const r = reachDeg * gain(rel, hpbw)
    const coslat = Math.cos((lat * Math.PI) / 180)
    ring.push([lng + Math.sin(th) * r / Math.max(coslat, 0.2), lat + Math.cos(th) * r])
  }
  ring.push(ring[0])
  return ring
}

/**
 * On-air is drawn as plain ink — it is the baseline, and only the exceptions
 * (alarm, planned, locked) get colour. That inverts on a dark basemap: near-black
 * on #0E1216 is invisible, so the baseline becomes light instead. The exception
 * hues are legible either way and stay put.
 */
function statusColor(status, inAlarm, dark = false) {
  if (inAlarm || status === 'partial') return dark ? '#E4685C' : '#A9433A'
  if (status === 'planned') return dark ? '#D9A62A' : '#9A7614'
  if (status === 'locked') return dark ? '#7C776E' : '#8A8378'
  return dark ? '#DCD8CE' : '#1A1612'
}

function inBounds(lng, lat, b, pad = 0.04) {
  if (!b) return true
  const west = b.getWest?.() ?? b[0]
  const south = b.getSouth?.() ?? b[1]
  const east = b.getEast?.() ?? b[2]
  const north = b.getNorth?.() ?? b[3]
  return lng >= west - pad && lng <= east + pad && lat >= south - pad && lat <= north + pad
}

export function buildGeo(sites, cells, { bandPin = null, selectedId = null, bounds = null, zoom = 13, keepIds = null, dark = false } = {}) {
  const bySite = Object.fromEntries(sites.map((s) => [s.site_id, s]))
  const siteFc = { type: 'FeatureCollection', features: [] }
  const sectorFc = { type: 'FeatureCollection', features: [] }
  const spiderFc = { type: 'FeatureCollection', features: [] }
  const labelFc = { type: 'FeatureCollection', features: [] }
  const skipSectors = zoom < 10
  const cullSectors = !skipSectors && cells.length > 2500
  const idxBySite = {}

  for (const s of sites) {
    const lng = v(s.lng)
    const lat = v(s.lat)
    const status = v(s.status)
    siteFc.features.push({
      type: 'Feature',
      id: s.site_id,
      properties: {
        id: s.site_id,
        status,
        in_alarm: s.in_alarm ? 1 : 0,
        color: statusColor(status, s.in_alarm, dark),
        selected: selectedId === s.site_id ? 1 : 0,
      },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })
  }

  if (!skipSectors) for (const c of cells) {
    // Explicitly monitored cells (Tier-1 neighbours) bypass the band pin and the
    // viewport cull — a filter must not hide a sector we are drawing a connector to.
    const pinned = keepIds?.has(c.cell_id)
    if (!pinned && bandPin && v(c.band) !== bandPin) continue
    const site = bySite[c.site_id]
    if (!site) continue
    const lng0 = v(c.lng)
    const lat0 = v(c.lat)
    if (!pinned && cullSectors && !inBounds(lng0, lat0, bounds)) continue
    const az = v(c.azimuth)
    const hpbw = v(c.hpbw) || 65
    const i = idxBySite[c.site_id] || 0
    idxBySite[c.site_id] = i + 1
    const [lng, lat] = offsetOrigin(lng0, lat0, az, { index: i, band: v(c.band) })
    const reach = screenReachDeg(lat, zoom)
    const color = statusColor(v(c.status), c.in_alarm, dark)
    const selected = selectedId === c.site_id || selectedId === c.cell_id
    sectorFc.features.push({
      type: 'Feature',
      id: c.cell_id,
      properties: {
        id: c.cell_id,
        site_id: c.site_id,
        cell_name: v(c.cell_name),
        pci: v(c.pci),
        band: v(c.band),
        azimuth: az,
        color,
        selected: selected ? 1 : 0,
        in_alarm: c.in_alarm ? 1 : 0,
        // Constant, for the same reason reach is constant: uniform beams read as one instrument.
        beam_height_m: BEAM_HEIGHT_M,
      },
      geometry: { type: 'Polygon', coordinates: [lobePolygon(lng, lat, az, hpbw, reach)] },
    })
    spiderFc.features.push({
      type: 'Feature',
      properties: { id: c.cell_id, site_id: c.site_id, color },
      geometry: { type: 'LineString', coordinates: [[lng0, lat0], [lng, lat]] },
    })
    const labelR = reach * 0.62
    const azr = (az * Math.PI) / 180
    const coslat = Math.cos((lat * Math.PI) / 180)
    labelFc.features.push({
      type: 'Feature',
      properties: {
        id: c.cell_id,
        site_id: c.site_id,
        label: `${v(c.cell_name)}  PCI ${v(c.pci)}  ${v(c.band)}`,
        selected,
      },
      geometry: {
        type: 'Point',
        coordinates: [lng + Math.sin(azr) * labelR / Math.max(coslat, 0.2), lat + Math.cos(azr) * labelR],
      },
    })
  }

  return { siteFc, sectorFc, spiderFc, labelFc }
}

/** Planned / coming-soon rings from cell-plan status — not a second invented network. */
export function buildPlanned(sites) {
  const features = []
  for (const s of sites) {
    if (v(s.status) !== 'planned') continue
    const lng = v(s.lng)
    const lat = v(s.lat)
    if (lng == null || lat == null) continue
    features.push({
      type: 'Feature',
      id: `planned-${s.site_id}`,
      properties: { id: s.site_id, site_id: s.site_id, status: 'planned' },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })
  }
  return { type: 'FeatureCollection', features }
}
