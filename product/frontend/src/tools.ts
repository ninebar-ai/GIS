import { bearing, circle, distance, lineString, point } from '@turf/turf'

import { v } from './lobes'

export function searchHits(inv, q, limit = 12) {
  const s = (q || '').trim().toLowerCase()
  if (s.length < 2) return []
  const out = []
  for (const site of inv.sites) {
    for (const c of inv.cells.filter((x) => x.site_id === site.site_id)) {
      const keys = [site.site_id, v(site.sarf_id), v(site.enb_name), v(c.ecgi), v(c.cell_name), c.cell_id, String(v(c.pci))]
      if (keys.some((k) => String(k).toLowerCase().includes(s))) {
        out.push({
          siteId: site.site_id,
          cellId: c.cell_id,
          title: `${site.site_id} · ${v(c.cell_name)}`,
          meta: `${v(c.ecgi)} · ${v(site.sarf_id)}`,
          lng: v(site.lng),
          lat: v(site.lat),
        })
        if (out.length >= limit) return out
        break
      }
    }
  }
  return out
}

export function measureDistance(a, b) {
  const from = point(a)
  const to = point(b)
  const m = distance(from, to, { units: 'meters' })
  const brg = bearing(from, to)
  return {
    kind: 'distance',
    meters: m,
    bearing: brg,
    label: `${m.toFixed(0)} m · bearing ${brg.toFixed(0)}°`,
    fc: { type: 'FeatureCollection', features: [lineString([a, b])] },
  }
}

export function measureRadius(center, edge) {
  const m = distance(point(center), point(edge), { units: 'meters' })
  const ring = circle(center, m / 1000, { steps: 64, units: 'kilometers' })
  return {
    kind: 'radius',
    meters: m,
    label: `Radius ${m.toFixed(0)} m`,
    fc: { type: 'FeatureCollection', features: [ring] },
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function layersToGeoJSON(layers) {
  const features = []
  for (const l of layers) {
    for (const f of l.fc.features) {
      features.push({ ...f, properties: { ...f.properties, layer: l.name } })
    }
  }
  return { type: 'FeatureCollection', features }
}

export function layersToKml(layers) {
  const marks = []
  for (const l of layers) {
    for (const f of l.fc.features) {
      const g = f.geometry
      const name = esc(f.properties.label || f.properties.id || l.name)
      if (g.type === 'Point') {
        const [lng, lat] = g.coordinates
        marks.push(`<Placemark><name>${name}</name><Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark>`)
      } else if (g.type === 'LineString') {
        const coords = g.coordinates.map(([lng, lat]) => `${lng},${lat},0`).join(' ')
        marks.push(`<Placemark><name>${name}</name><LineString><coordinates>${coords}</coordinates></LineString></Placemark>`)
      } else if (g.type === 'Polygon') {
        const ring = g.coordinates[0].map(([lng, lat]) => `${lng},${lat},0`).join(' ')
        marks.push(`<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`)
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${marks.join('')}</Document></kml>`
}

export function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function parseImport(text, name) {
  const lower = (name || '').toLowerCase()
  if (lower.endsWith('.kml') || text.includes('<kml')) return kmlToFc(text)
  return JSON.parse(text)
}

function kmlToFc(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const features = []
  doc.querySelectorAll('Placemark').forEach((pm) => {
    const name = pm.querySelector('name')?.textContent || 'user'
    const coord = (el) => (el?.textContent || '').trim().split(/\s+/).map((p) => {
      const [lng, lat] = p.split(',').map(Number)
      return [lng, lat]
    }).filter((p) => Number.isFinite(p[0]))
    const pt = pm.querySelector('Point coordinates') || pm.querySelector('Point > coordinates')
    const ls = pm.querySelector('LineString coordinates')
    const pg = pm.querySelector('LinearRing coordinates') || pm.querySelector('Polygon coordinates')
    let geometry = null
    if (pt) geometry = { type: 'Point', coordinates: coord(pt)[0] }
    else if (ls) geometry = { type: 'LineString', coordinates: coord(ls) }
    else if (pg) geometry = { type: 'Polygon', coordinates: [coord(pg)] }
    if (geometry) features.push({ type: 'Feature', properties: { id: name, source: 'user' }, geometry })
  })
  return { type: 'FeatureCollection', features }
}

async function waitForFrame(map: any) {
  if (!map) return
  try { map.triggerRepaint?.() } catch { /* */ }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

function waitMapIdle(map: any, ms = 1200) {
  return new Promise<void>((resolve) => {
    if (!map) return resolve()
    const settledNow = map.loaded?.() && map.isStyleLoaded?.() && (typeof map.areTilesLoaded !== 'function' || map.areTilesLoaded())
    if (settledNow) return resolve()
    let done = false
    const finish = () => {
      if (done) return
      done = true
      try { map.off?.('idle', finish) } catch { /* */ }
      resolve()
    }
    try { map.on?.('idle', finish) } catch { /* */ }
    setTimeout(finish, ms)
  })
}

function likelyBlank(ctx, w, h) {
  const n = 14
  let varied = 0
  for (let i = 1; i <= n; i++) {
    const x = Math.min(w - 1, Math.max(0, ((i * (w - 1)) / (n + 1)) | 0))
    const y = Math.min(h - 1, Math.max(0, (((n - i + 1) * (h - 1)) / (n + 1)) | 0))
    const d = ctx.getImageData(x, y, 1, 1).data
    const r = d[0], g = d[1], b = d[2], a = d[3]
    // Count pixels that are not near white/black transparent background.
    const nearWhite = r > 242 && g > 242 && b > 242
    const nearBlack = r < 12 && g < 12 && b < 12
    if (a > 0 && !nearWhite && !nearBlack) varied++
  }
  return varied < 2
}

function composeMapCanvases(map) {
  const base = map.getCanvas()
  const w = base.width
  const h = base.height
  if (!w || !h) throw new Error('Map canvas has zero size')

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  // White sheet baseline so transparent layers don't export as black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  const canvases = Array.from(map.getContainer().querySelectorAll('canvas')) as HTMLCanvasElement[]
  let drawn = 0
  for (const c of canvases) {
    const style = getComputedStyle(c)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (!c.width || !c.height) continue
    const alpha = Number(style.opacity || '1')
    const prev = ctx.globalAlpha
    ctx.globalAlpha = Number.isFinite(alpha) ? alpha : 1
    try {
      ctx.drawImage(c, 0, 0, w, h)
      drawn++
    } catch {
      // Ignore non-readable canvases, continue with others.
    }
    ctx.globalAlpha = prev
  }
  if (!drawn) throw new Error('Could not read map canvases for snapshot')
  return { out, ctx, w, h }
}

export async function snapshotCanvas(map) {
  if (!map) throw new Error('Map is not ready')
  for (let attempt = 0; attempt < 4; attempt++) {
    await waitMapIdle(map, 900)
    await waitForFrame(map)
    const { out, ctx, w, h } = composeMapCanvases(map)
    if (!likelyBlank(ctx, w, h)) return out.toDataURL('image/png')
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  // Fallback: return direct map canvas if compositing kept producing a blank image.
  try {
    await waitForFrame(map)
    return map.getCanvas().toDataURL('image/png')
  } catch { /* */ }
  throw new Error('Snapshot looked blank after retries')
}

export function downloadPng(dataUrl, filename) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}
