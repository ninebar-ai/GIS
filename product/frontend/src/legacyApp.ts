import maplibregl from 'maplibre-gl'
import { v, buildGeo, buildPlanned } from './lobes'
import { defaultRecipe, applyRecipe, counts, chipList, dismissChip, sanitizeRecipe } from './filters'
import { createMap, dressAndPaint, setMeasureData, setUserData, setProbeData, queryHit, setBasemap, visibleLayers, applyView, setSelectedState, setSectorData, DARK_BASEMAPS } from './map'
import { searchHits, measureDistance, measureRadius, layersToGeoJSON, layersToKml, download, parseImport, snapshotCanvas, downloadPng } from './tools'
import { interpretWithStream, contextChips, getUserId, scopeEcho, recordFeedback, ensureFly } from './chat'
import { pickPoint, describePick, COLOR_STOPS } from './heavy'
import { loadInventory, loadHeavy, loadDtPaths, tileUrls, source as dataSource } from './data'
import { buildHoles } from './holes'
import { distanceM, bearingDeg, tier1Candidates, tier1CandidatesAt, monitoredIds, neighborLines, candidateFc, PIN_ID, sessionKey, persistNeighbors, recallNeighbors, applyRecall, appendEvent, auditPayload, auditCsv, formatNeighborNarrate } from './neighbors'
import { state, notify, askQueue, setAskQueue, sectorFrame, setSectorFrame } from './workbench/state'

export { state, subscribe, getRev, LAYER_RAIL } from './workbench/state'

const $ = (id: string) => document.getElementById(id) as HTMLElement & HTMLInputElement & HTMLFormElement & Record<string, any>

function stopSpeaking() {
  try { window.speechSynthesis?.cancel() } catch { /* */ }
}

function stopVoiceCapture() {
  try { state.voiceRec?.stop() } catch { /* */ }
  $('btn-mic')?.classList.remove('on')
}

function enqueueAsk(q: string, opts: any = {}) {
  const text = (q || '').trim()
  if (!text) return
  stopSpeaking()
  if (!opts.voice) {
    state.voiceOut = false
    stopVoiceCapture()
  }
  setCopilotOpen(true)
  setAskQueue(askQueue.catch(() => {}).then(() => ask(text, opts)).catch((err: any) => {
    logMsg(`Copilot error: ${err?.message || String(err)}`, 'bot', { provenance: 'degraded', route: 'error' })
    setChatBusy(false)
  }))
}

const CHAT_LOG_MAX = 80
const chatKey = () => `n1_chat_log_${getUserId()}`

function readChatLog() {
  try {
    const raw = localStorage.getItem(chatKey())
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeChatLog(items) {
  try {
    localStorage.setItem(chatKey(), JSON.stringify(items.slice(-CHAT_LOG_MAX)))
  } catch {}
}

function clearChatLog() {
  try { localStorage.removeItem(chatKey()) } catch {}
}

function persistChatEntry(text, who, ts = Date.now()) {
  const hist = readChatLog()
  hist.push({ text: String(text ?? ''), who, ts })
  writeChatLog(hist)
}

function recipeHash() {
  const payload = { recipe: state.recipe, selected: state.selected, camera: camera() }
  history.replaceState(null, '', `#r=${encodeURIComponent(JSON.stringify(payload))}`)
}

function camera() {
  const c = state.map?.getCenter()
  return c ? { center: [c.lng, c.lat], zoom: state.map.getZoom(), pitch: state.map.getPitch(), bearing: state.map.getBearing() } : null
}

function loadHash() {
  const h = location.hash
  if (!h.startsWith('#r=')) return
  try {
    const p = JSON.parse(decodeURIComponent(h.slice(3)))
    if (p.recipe) state.recipe = { ...defaultRecipe(), ...p.recipe }
    if (p.selected) state.selected = p.selected
    return p.camera
  } catch { return null }
}

/** Dark ground under the vectors means the status palette flips (see lobes.js). */
function onDarkBasemap() {
  return DARK_BASEMAPS.has($('basemap')?.value || 'dark')
}

function filtered() {
  return applyRecipe(state.inv, state.recipe)
}

/** Monitored neighbours (and the target) must survive the recipe filters — otherwise a
 *  status/band filter hides the sector while its connector line still draws to it. */
function withNeighbors(sites, cells, neighborIds) {
  if (!state.neighbors) return { sites, cells }
  const haveCells = new Set(cells.map((c) => c.cell_id))
  const addCells = state.inv.cells.filter((c) => neighborIds.has(c.cell_id) && !haveCells.has(c.cell_id))
  const wantSites = new Set(addCells.map((c) => c.site_id))
  if (state.neighbors.kind !== 'pin') wantSites.add(state.neighbors.targetId)
  const haveSites = new Set(sites.map((s) => s.site_id))
  const addSites = state.inv.sites.filter((s) => wantSites.has(s.site_id) && !haveSites.has(s.site_id))
  return {
    sites: addSites.length ? sites.concat(addSites) : sites,
    cells: addCells.length ? cells.concat(addCells) : cells,
  }
}

function buildDtPreview(dt, cap = 4800) {
  const n = Number(dt?.n || 0)
  const pos = dt?.positions
  const rsrp = dt?.rsrp
  if (!n || !pos || pos.length < 3) return { type: 'FeatureCollection', features: [] }
  const step = Math.max(1, Math.ceil(n / cap))
  const features = []
  for (let i = 0; i < n; i += step) {
    const lng = pos[i * 3]
    const lat = pos[i * 3 + 1]
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    features.push({
      type: 'Feature',
      properties: { id: `dtp_${i}`, rsrp: Number.isFinite(rsrp?.[i]) ? Number(rsrp[i]) : null, source: 'dt.bin' },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })
  }
  return { type: 'FeatureCollection', features }
}

function paint() {
  const neighborIds = monitoredIds(state.neighbors)
  const nbLines = state.neighbors ? neighborLines(state.inv, state.neighbors, neighborIds) : null
  const pinFc = candidateFc(state.neighbors)
  const base = filtered()
  const { sites, cells } = withNeighbors(base.sites, base.cells, neighborIds)
  const bandPin = state.recipe.band.length === 1 ? state.recipe.band[0] : null
  const zoom = state.map?.getZoom?.() ?? 13
  const bounds = state.map?.getBounds?.() ?? null
  state.geo = { ...buildGeo(sites, cells, { bandPin, selectedId: state.selected, bounds, zoom, keepIds: neighborIds, dark: onDarkBasemap() }), plannedFc: buildPlanned(state.inv.sites) }
  if (state.map) {
    dressAndPaint(state.map, state.geo, state.recipe, {
      gh: state.heavy?.gh,
      dt: state.heavy?.dt,
      dtPaths: state.dtPaths,
      dtPreview: state.dtPreview,
      selectedId: state.selected,
      holes: state.holesFc,
      tileUrls: tileUrls(),
      neighborIds,
      neighborLines: nbLines,
      candidateFc: pinFc,
    })
  }
  const c = counts(state.inv, state.recipe)
  const gpu = (state.heavy?.gh?.n || c.gh) + (state.heavy?.dt?.n || c.dt)
  const via = dataSource.tiles ? 'PostGIS tiles' : 'files'
  state.hud.counts = `${c.sites} sites · ${c.cells} cells · ${c.alarm} in alarm · ${gpu.toLocaleString()} pts · ${via}`
  state.hud.countsTitle = dataSource.reason || `Serving from ${via}`
  syncLayerRail()
  renderLegend()
  renderPicker()
  renderContextStrip()
  renderChips()
  renderCard()
  renderCopilotScope()
  updateHud()
  recipeHash()
  notify()
}

export function applyRecipeChange(next: any) {
  state.recipe = next
  paint()
}

/**
 * Rebuild sector geometry for the current zoom and push only the three sector
 * sources. Lobe reach is constant on screen (lobes.js screenReachDeg), so the
 * polygons change as the camera zooms — but paint() would rebuild the facets
 * drawer, chips, card and URL hash too, which is far too much for a zoom frame.
 */
function repaintSectors() {
  if (!state.map || !state.inv || !state.geo) return
  const neighborIds = monitoredIds(state.neighbors)
  const base = filtered()
  const { sites, cells } = withNeighbors(base.sites, base.cells, neighborIds)
  const bandPin = state.recipe.band.length === 1 ? state.recipe.band[0] : null
  const next: any = buildGeo(sites, cells, {
    bandPin,
    selectedId: state.selected,
    bounds: state.map.getBounds?.() ?? null,
    zoom: state.map.getZoom?.() ?? 13,
    keepIds: neighborIds,
    dark: onDarkBasemap(),
  })
  next.plannedFc = state.geo?.plannedFc
  state.geo = next
  setSectorData(state.map, state.geo, state.recipe)
}

/** One sector rebuild per frame while the camera is moving, never more. */
function queueSectorRepaint() {
  if (sectorFrame) return
  setSectorFrame(requestAnimationFrame(() => {
    setSectorFrame(0)
    try { repaintSectors() } catch (err) { console.warn('repaintSectors', err) }
  }))
}

/**
 * Windy-style layer rail. vocLayer is deliberately absent — it has a recipe key
 * and a drawer checkbox but no renderer in map.js or heavy.js, and ingest drops
 * the points, so it would be a switch that does nothing.
 */
const LAYER_RAIL = [
  { key: 'sectorsLayer', glyph: '◗', tag: 'Sect', label: 'Sector lobes' },
  { key: 'spiderLayer', glyph: '⁂', tag: 'Cosi', label: 'Co-site spider (z≥14)' },
  { key: 'plannedLayer', glyph: '◎', tag: 'Plan', label: 'Planned sites' },
  { key: 'ghLayer', glyph: '▩', tag: 'GH', label: 'Groundhog RSRP' },
  { key: 'dtLayer', glyph: '⟿', tag: 'DT', label: 'Drive test' },
  { key: 'holesLayer', glyph: '⬡', tag: 'Hole', label: 'Coverage holes' },
  { key: 'ghContourLayer', glyph: '◍', tag: 'Cont', label: 'Groundhog contour' },
]

function bindLayerRail() {
  const rail = $('layer-rail')
  if (!rail) return
  rail.innerHTML = LAYER_RAIL.map((l) => `
    <button type="button" class="layer-btn" data-layer="${l.key}" title="${l.label}" aria-pressed="false">
      <span class="glyph" aria-hidden="true">${l.glyph}</span><span class="tag">${l.tag}</span>
    </button>`).join('')
  rail.querySelectorAll('[data-layer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.layer
      state.recipe[key] = !state.recipe[key]
      // Same path the drawer checkboxes use, so renderFacets() inside paint()
      // keeps the two controls in sync with no extra wiring.
      paint()
      recipeHash()
    })
  })
  syncLayerRail()
}

function syncLayerRail() {
  document.querySelectorAll('#layer-rail [data-layer]').forEach((btn) => {
    const on = !!state.recipe[btn.dataset.layer]
    btn.classList.toggle('on', on)
    btn.setAttribute('aria-pressed', String(on))
  })
}

/**
 * RSRP scale, built from heavy.js COLOR_STOPS so the legend and the GPU ramp
 * cannot drift apart. Only shown while a layer that uses it is on, and it names
 * its source and window — the build checklist asks for both.
 */
function renderLegend() {
  const el = $('legend')
  if (!el) return
  const r = state.recipe
  const on = r.ghLayer || r.dtLayer || r.ghContourLayer || r.holesLayer
  el.hidden = !on
  if (!on) return
  const lo = COLOR_STOPS[0][0]
  const hi = COLOR_STOPS[COLOR_STOPS.length - 1][0]
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`
  const ramp = COLOR_STOPS
    .map(([val, c]) => `${rgb(c)} ${(((val - lo) / (hi - lo)) * 100).toFixed(1)}%`)
    .join(', ')
  const sources = []
  if (r.ghLayer || r.ghContourLayer || r.holesLayer) sources.push(`Groundhog ${nFmt(state.heavy?.gh?.n)}`)
  if (r.dtLayer) sources.push(`drive test ${nFmt(state.heavy?.dt?.n)}`)
  el.innerHTML = `
    <div class="legend-head u-mono">RSRP dBm</div>
    <div class="legend-ramp" style="background: linear-gradient(90deg, ${ramp})"></div>
    <div class="legend-ticks">${COLOR_STOPS.map(([val]) => `<span>${val}</span>`).join('')}</div>
    <div class="legend-foot u-mono">${sources.join(' · ')}${state.inv?.clock?.t ? ` · ${state.inv.clock.t.slice(0, 16)}` : ''}</div>`
}

const nFmt = (n) => Number(n || 0).toLocaleString()

/**
 * Windy-style picker: a puck pinned to a ground point that keeps reporting what
 * is there as you pan and zoom, rather than the transient hover readout. Its
 * numbers come from the same arrays the layers draw, never from an estimate.
 */
function nearestSample(lng, lat, packed, maxM = 260) {
  const n = Number(packed?.n || 0)
  if (!n || !packed.positions) return null
  const coslat = Math.cos((lat * Math.PI) / 180)
  let bestI = -1
  let bestD2 = Infinity
  for (let i = 0; i < n; i++) {
    const dLng = (packed.positions[i * 3] - lng) * coslat
    const dLat = packed.positions[i * 3 + 1] - lat
    const d2 = dLng * dLng + dLat * dLat
    if (d2 < bestD2) { bestD2 = d2; bestI = i }
  }
  if (bestI < 0) return null
  const metres = Math.sqrt(bestD2) * 111320
  if (metres > maxM) return null
  return { rsrp: packed.rsrp[bestI], metres }
}

function nearestSiteTo(lng, lat) {
  let best = null
  for (const s of state.inv?.sites || []) {
    const sLng = Number(v(s.lng))
    const sLat = Number(v(s.lat))
    if (!validJapanCoord(sLng, sLat)) continue
    const d = distanceM(lat, lng, sLat, sLng)
    if (!best || d < best.metres) best = { id: s.site_id, metres: d, bearing: bearingDeg(lat, lng, sLat, sLng), status: v(s.status), inAlarm: !!s.in_alarm }
  }
  return best
}

function setPicker(lngLat) {
  state.picker = lngLat ? { lng: lngLat.lng, lat: lngLat.lat } : null
  renderPicker()
}

function renderPicker() {
  const el = $('picker')
  if (!el) return
  const p = state.picker
  if (!p || !state.map) { el.hidden = true; return }
  const pt = state.map.project([p.lng, p.lat])
  // Hide rather than draw off-canvas when the pinned point leaves the view.
  const c = state.map.getCanvas()
  if (pt.x < -40 || pt.y < -40 || pt.x > c.clientWidth + 40 || pt.y > c.clientHeight + 40) {
    el.hidden = true
    return
  }
  el.hidden = false
  el.style.left = `${pt.x}px`
  el.style.top = `${pt.y}px`

  const rows = []
  const site = nearestSiteTo(p.lng, p.lat)
  if (site) {
    rows.push(`<div class="pick-row"><b>${site.id}</b><span>${Math.round(site.metres)} m · ${Math.round(site.bearing)}°</span></div>`)
    rows.push(`<div class="pick-row u-mono"><span>${site.status}${site.inAlarm ? ' · in alarm' : ''}</span></div>`)
  }
  const gh = state.recipe.ghLayer || state.recipe.ghContourLayer || state.recipe.holesLayer
    ? nearestSample(p.lng, p.lat, state.heavy?.gh) : null
  const dt = state.recipe.dtLayer ? nearestSample(p.lng, p.lat, state.heavy?.dt) : null
  if (gh) rows.push(`<div class="pick-row"><span>GH</span><b>${gh.rsrp.toFixed(1)} dBm</b><span class="u-mono">${Math.round(gh.metres)} m</span></div>`)
  if (dt) rows.push(`<div class="pick-row"><span>DT</span><b>${dt.rsrp.toFixed(1)} dBm</b><span class="u-mono">${Math.round(dt.metres)} m</span></div>`)
  if (!gh && !dt && (state.recipe.ghLayer || state.recipe.dtLayer)) {
    rows.push('<div class="pick-row u-mono"><span>no sample within 260 m</span></div>')
  }

  el.innerHTML = `
    <button type="button" class="pick-x" id="pick-x" aria-label="Close picker">×</button>
    <div class="pick-coord u-mono">${p.lat.toFixed(5)} N · ${p.lng.toFixed(5)} E</div>
    ${rows.join('')}`
  el.querySelector('#pick-x')?.addEventListener('click', () => setPicker(null))
}

function renderContextStrip() {
  const label = $('context-label')
  const box = $('context-actions')
  const strip = $('context-strip')
  if (!label || !box) return
  // It floats over the map now, so it only earns its space when there is real
  // context. New site / Snapshot / Layers already live in the bar and the rail.
  if (strip) strip.hidden = !state.selected && !state.section
  if (strip?.hidden) return
  let context = 'overview'
  if (state.section === 'neighbors') context = 'neighbor session'
  else if (state.selected) context = 'site selection'
  else if (state.section === 'gh') context = 'groundhog view'
  else if (state.section === 'dt') context = 'drive-test view'
  label.textContent = `Context · ${context}`

  const actions = []
  if (state.selected) actions.push({ key: 'inspect', label: 'Inspect' })
  if (state.selected && state.selected !== PIN_ID) actions.push({ key: 'tier1', label: 'Tier-1' })
  if (state.section === 'neighbors') actions.push({ key: 'audit', label: 'Export audit' })
  actions.push({ key: 'drop', label: 'New site' })
  actions.push({ key: 'snapshot', label: 'Snapshot' })
  actions.push({ key: 'filters', label: 'Layers' })

  box.innerHTML = actions.map((a) => `<button type="button" class="ctx-btn" data-ctx="${a.key}">${a.label}</button>`).join('')
  box.querySelectorAll('[data-ctx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.ctx
      if (key === 'inspect') toggle('copilot', true)
      else if (key === 'tier1' && state.selected) startNeighbors(state.selected)
      else if (key === 'audit') exportAudit('json')
      else if (key === 'drop') setTool('drop')
      else if (key === 'snapshot') $('btn-shot').click()
      else if (key === 'filters') toggle('rail', true)
    })
  })
}

function renderChips() {
  const chips = chipList(state.recipe)
  $('chips').innerHTML = chips.map((ch, i) =>
    `<span class="chip">${ch.label}<button type="button" data-i="${i}" aria-label="Remove">×</button></span>`
  ).join('')
  $('chips').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      state.recipe = dismissChip(state.recipe, chips[Number(b.dataset.i)])
      paint()
    })
  })
}

function renderCopilotScope() {
  const el = $('copilot-scope')
  if (!el || !state.inv) return
  el.textContent = `Scope · ${scopeEcho(state.inv, state.selected, state.section)}`
}

function renderStarters() {
  const chips = contextChips({ section: state.section, selected: state.selected, inv: state.inv })
  $('starters').innerHTML = chips.map((s) => {
    const label = String(s.label ?? s).replace(/</g, '&lt;')
    const ask = String(s.ask ?? s).replace(/"/g, '&quot;')
    const hint = s.hint ? `<span class="starter-hint">${String(s.hint).replace(/</g, '&lt;')}</span>` : ''
    return `<button type="button" class="starter" data-ask="${ask}"><span class="starter-label">${label}</span>${hint}</button>`
  }).join('')
  $('starters').querySelectorAll('button').forEach((b) => {
    b.onclick = () => enqueueAsk(b.dataset.ask)
  })
}

function siteOf(id) {
  return state.inv.sites.find((s) => s.site_id === id)
}

function metaCell(label, value) {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`
}

function renderConfig(site, cells) {
  const head = cells[0]
  const carrier = head
    ? `${v(head.tech)} ${v(head.band)} · EARFCN ${v(head.earfcn_dl) ?? '—'}/${v(head.earfcn_ul) ?? '—'} · ${v(head.bandwidth) || '—'}`
    : '—'
  return `
    <table>
      <tr><th>eNB</th><td>${v(site.enb_name)} · id ${v(site.enb_id)}</td></tr>
      <tr><th>Carrier</th><td>${carrier}</td></tr>
      <tr><th>Height</th><td>${v(site.height_m) ?? '—'} m</td></tr>
      <tr><th>Hotspot</th><td>${cells.map((c) => v(c.hotspot)).filter(Boolean)[0] || '—'}</td></tr>
    </table>
    <table>
      <thead><tr><th>Cell</th><th>ECGI</th><th>PCI</th><th>Az</th><th>HPBW</th><th>Tilt m/e</th><th>Tx</th></tr></thead>
      <tbody>
      ${cells.map((c) => {
        const mech = v(c.mech_tilt)
        const elec = v(c.elec_tilt)
        const tx = v(c.tx_power)
        return `<tr class="row-hit" data-cell="${c.cell_id}"><td>${v(c.cell_name)}</td><td>${v(c.ecgi)}</td><td>${v(c.pci)}</td><td>${v(c.azimuth)}°</td><td>${v(c.hpbw) || 65}°</td><td>${mech ?? '—'}°/${elec ?? '—'}°</td><td>${tx == null ? '—' : `${tx} dBm`}</td></tr>`
      }).join('')}
      </tbody>
    </table>
    <div class="prov">Config ← cell-plan. ECGI envelope 440-11-{enb}-{cell}. No CM join, no MSI/.pattern, no daily on-air file.</div>
  `
}

function bindCardChrome(el) {
  $('card-x').onclick = () => { clearNeighbors(); state.selected = null; paint(); renderStarters() }
  el.querySelectorAll('[data-cell]').forEach((row) => {
    row.onclick = () => {
      const cid = row.dataset.cell
      if (state.map) {
        try { state.map.setFeatureState({ source: 'sectors', id: cid }, { selected: true }) } catch { /* */ }
      }
    }
  })
  el.querySelectorAll('[data-nb-x]').forEach((btn) => {
    btn.onclick = () => toggleNeighborCell(btn.dataset.nbX)
  })
  const jsonBtn = $('nb-json')
  const csvBtn = $('nb-csv')
  if (jsonBtn) jsonBtn.onclick = () => exportAudit('json')
  if (csvBtn) csvBtn.onclick = () => exportAudit('csv')
}

function renderCard() {
  const el = $('card')
  if (state.neighbors?.kind === 'pin' && (state.selected === PIN_ID || !state.selected)) {
    const n = monitoredIds(state.neighbors).size
    el.hidden = false
    placeCard()
    el.innerHTML = `
      <header class="card-head">
        <div>
          <div class="u-mono kicker">Candidate · not in inventory</div>
          <h2>New site</h2>
          <dl class="metastrip">
            ${metaCell('Facing', `${n} sectors`)}
            ${metaCell('Lat', state.neighbors.lat.toFixed(5))}
            ${metaCell('Lng', state.neighbors.lng.toFixed(5))}
          </dl>
        </div>
        <button type="button" class="icon-btn" id="card-x" aria-label="Close">×</button>
      </header>
      <div class="card-body">
        ${renderNeighborSection(state.neighbors)}
        <div class="prov">WGS84 · ${state.inv.clock?.t || '—'} ← ${state.inv.clock?.source || 'clock'}</div>
      </div>
    `
    bindCardChrome(el)
    return
  }
  const site = siteOf(state.selected)
  if (!site) { el.hidden = true; return }
  const cells = state.inv.cells.filter((c) => c.site_id === site.site_id)
  const alarms = (site.alarms || []).map((a) =>
    `<div class="alarm ${a.severity}">${a.severity} · ${a.problem}${a.root_cause ? ' · root' : ''}<div class="prov">${a.text || ''} ← ${a.source}</div></div>`
  ).join('')
  const nbOn = state.neighbors?.kind !== 'pin' && state.neighbors?.targetId === site.site_id
  el.hidden = false
  placeCard()
  el.innerHTML = `
    <header class="card-head">
      <div>
        <div class="u-mono kicker">Site · ${v(site.status)}</div>
        <h2>${site.site_id}</h2>
        <div class="prov">${v(site.sarf_id)} · ${v(site.site_type_plan)}</div>
        <dl class="metastrip">
          ${metaCell('EMS', v(site.ems_server) || '—')}
          ${metaCell('Cells', String(cells.length))}
          ${metaCell('Alarms', `${site.alarm_summary?.count || 0}`)}
          ${metaCell('Type', `${v(site.site_type)} · ${v(site.morphology)}`)}
        </dl>
      </div>
      <button type="button" class="icon-btn" id="card-x" aria-label="Close">×</button>
    </header>
    <div class="card-body">
    ${nbOn ? renderNeighborSection(state.neighbors) : ''}
    ${renderConfig(site, cells)}
    ${alarms || ''}
    ${site.note ? `<div class="prov">${site.note}</div>` : ''}
    <div class="prov">${Number(v(site.lat)).toFixed(5)} N · ${Number(v(site.lng)).toFixed(5)} E · WGS84 ← cell-plan · ${state.inv.clock?.t || '—'}</div>
    </div>
  `
  bindCardChrome(el)
}

function renderNeighborSection(nb) {
  const ids = [...monitoredIds(nb)]
  const rows = ids.map((id) => {
    const c = state.inv.cells.find((x) => x.cell_id === id)
    if (!c) return ''
    const added = nb.added.has(id)
    const tag = added ? '<em>+added</em>' : '<span class="tag-auto">auto</span>'
    return `<div class="nb-row">${c.site_id} · ${v(c.cell_name)} ${tag}<button type="button" data-nb-x="${id}" aria-label="Remove">×</button></div>`
  }).join('')
  const log = (nb.events || []).slice(-8).reverse().map((e) => {
    const clock = (e.t || '').replace('T', ' ').slice(11, 19)
    return `<div class="nb-log-row">${clock} · ${e.action}${e.cellId ? ` · ${e.cellId}` : ''}</div>`
  }).join('')
  return `
    <div class="nb-panel">
      <div class="nb-head">Tier-1 · ${ids.length} monitored</div>
      <p class="nb-sub">${nb.auto.size} auto within 1.2 km${nb.added.size ? ` · +${nb.added.size} added` : ''}${nb.removed.size ? ` · −${nb.removed.size} removed` : ''} · click a sector to add or remove. Audit stays in this browser.</p>
      <div class="nb-list">${rows || '<div class="nb-row">None facing within range — add sectors by clicking them.</div>'}</div>
      <div class="nb-actions">
        <button type="button" id="nb-json">Audit JSON</button>
        <button type="button" id="nb-csv">Audit CSV</button>
      </div>
      <div class="nb-log">${log || '<div class="nb-log-row">Auto-proposed set is the trail until you add or remove.</div>'}</div>
    </div>
  `
}

function cinematic() {
  const three = state.recipe.view === '3d'
  state.map.flyTo({
    center: [139.7034, 35.661],
    zoom: three ? 14.05 : 13.4,
    pitch: three ? 64 : 0,
    bearing: three ? -28 : 0,
    duration: 900,
  })
}

function validJapanCoord(lng, lat) {
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= 122 && lng <= 154 && lat >= 20 && lat <= 47
}

function flyToSite(id, minZoom = 15) {
  const s = siteOf(id)
  if (!s || !state.map) return
  const lng = Number(v(s.lng))
  const lat = Number(v(s.lat))
  if (!validJapanCoord(lng, lat)) {
    logMsg(`No valid map coordinates for ${id}. Kept current view.`)
    return
  }
  const three = state.recipe.view === '3d'
  state.map.flyTo({
    center: [lng, lat],
    zoom: three ? Math.max(minZoom, 15.2) : minZoom,
    pitch: three ? 68 : 0,
    duration: 900,
  })
}

function flySet(pred, { minZoom = 14, maxZoom = 16 } = {}) {
  if (!state.map) return
  const sites = state.inv.sites.filter(pred)
  const pts = sites
    .map((s) => [Number(v(s.lng)), Number(v(s.lat)), s.site_id])
    .filter((p) => validJapanCoord(p[0], p[1]))
  if (!pts.length) return
  if (pts.length === 1) {
    flyToSite(pts[0][2], minZoom)
    return
  }
  const b = pts.reduce(
    (acc, p) => acc.extend([p[0], p[1]]),
    new maplibregl.LngLatBounds([pts[0][0], pts[0][1]], [pts[0][0], pts[0][1]]),
  )
  state.map.fitBounds(b, {
    padding: 100,
    duration: 900,
    maxZoom,
    minZoom,
    pitch: state.recipe.view === '3d' ? 58 : 0,
  })
}

/** Run a camera move once the map is ready (never rely on a load event that already fired). */
function runCameraAction(fn) {
  if (!state.map || typeof fn !== 'function') return
  let ran = false
  const go = () => {
    if (ran) return
    ran = true
    try { state.map.resize() } catch { /* */ }
    try { fn() } catch { /* */ }
  }
  if (state.map.loaded?.()) {
    requestAnimationFrame(() => requestAnimationFrame(go))
    state.map.once('idle', go)
    setTimeout(go, 500)
  } else {
    state.map.once('load', go)
    setTimeout(go, 1200)
  }
}

function executeFly(intent) {
  if (!intent?.fly || !state.map) return
  if (intent.fly === 'planned') flySet((s) => v(s.status) === 'planned')
  else if (intent.fly === 'alarms') {
    const alarmSites = state.inv.sites.filter((s) => s.in_alarm)
    if (alarmSites.length) {
      state.selected = intent.select || alarmSites[0].site_id
      if (state.map) setSelectedState(state.map, state.selected)
      renderCard()
    }
    flySet((s) => s.in_alarm, { minZoom: 14, maxZoom: 16 })
  } else if (intent.fly === 'select') flyToSite(state.selected)
  else if (intent.fly === 'dt' || intent.fly === 'dt-focus') flyDtFocus(state.heavy?.dt?.bbox || state.inv.drive_test?.bbox)
  else if (intent.fly === 'dt-near') flyDtNearSelection()
  else if (intent.fly === 'gh') flyBbox(state.heavy?.gh?.bbox || state.inv.groundhog?.bbox)
  else if (intent.fly === 'cluster') cinematic()
}

function flyBbox(b) {
  if (!b || b.length < 4) return cinematic()
  const bounds = new maplibregl.LngLatBounds([b[0], b[1]], [b[2], b[3]])
  state.map.fitBounds(bounds, { padding: 80, duration: 1100, maxZoom: 14.2, pitch: state.recipe.view === '3d' ? 52 : 0 })
}

function flyDtFocus(b) {
  if (!b || b.length < 4 || !state.map) return cinematic()
  const cx = (b[0] + b[2]) / 2
  const cy = (b[1] + b[3]) / 2
  const three = state.recipe.view === '3d'
  state.map.flyTo({
    center: [cx, cy],
    zoom: Math.max(state.map.getZoom(), three ? 13.6 : 13.15),
    pitch: three ? 58 : 0,
    duration: 950,
  })
}

function nearestDtPoint(lng, lat) {
  const fc = state.dtPaths
  if (!fc?.features?.length) return null
  let best = null
  let bestD = Infinity
  for (const f of fc.features) {
    const coords = f?.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) continue
    const stride = Math.max(1, Math.ceil(coords.length / 220))
    for (let i = 0; i < coords.length; i += stride) {
      const p = coords[i]
      if (!Array.isArray(p) || p.length < 2) continue
      const dx = p[0] - lng
      const dy = p[1] - lat
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
  }
  return best
}

function flyDtNearSelection() {
  if (!state.map) return
  let target = null
  const selected = state.selected && state.selected !== PIN_ID ? siteOf(state.selected) : null
  if (selected) target = nearestDtPoint(v(selected.lng), v(selected.lat))
  if (!target) {
    const c = state.map.getCenter()
    target = nearestDtPoint(c.lng, c.lat)
  }
  if (!target) return flyDtFocus(state.heavy?.dt?.bbox || state.inv.drive_test?.bbox)
  const three = state.recipe.view === '3d'
  state.map.flyTo({
    center: [target[0], target[1]],
    zoom: Math.max(state.map.getZoom(), three ? 14.4 : 14.2),
    pitch: three ? 56 : 0,
    duration: 900,
  })
}

function select(id) {
  // Leaving the target site tears the overlay down with it — otherwise the dashed
  // connectors linger with no card explaining them. Clearing state alone isn't enough:
  // select() doesn't normally repaint, so the stale lines need an explicit paint().
  const n = state.neighbors
  const dropping = !!n && (
    n.kind === 'pin' ? id !== PIN_ID : n.targetId !== id
  )
  if (dropping) clearNeighbors()
  state.selected = id
  if (state.map) setSelectedState(state.map, id)
  if (dropping) paint()
  renderCard()
  recipeHash()
  renderStarters()
  if (id && id !== PIN_ID) flyToSite(id)
}

function clearNeighbors() {
  if (!state.neighbors) return
  persistNeighbors(state.neighbors)
  const wasPin = state.neighbors.kind === 'pin'
  state.neighbors = null
  if (state.section === 'neighbors') state.section = null
  if (wasPin && state.selected === PIN_ID) state.selected = null
  hideMeasureBar()
}

function bootNeighborSession({ kind, targetId, lat, lng, autoIds, restored }: any) {
  const recalled = recallNeighbors(kind === 'pin'
    ? sessionKey({ kind: 'pin', lat, lng })
    : sessionKey({ kind: 'site', targetId }))
  const sets = applyRecall(autoIds, recalled)
  state.neighbors = { kind, targetId, lat, lng, ...sets }
  if (!sets.events.length) appendEvent(state.neighbors, restored && recalled ? 'restore' : 'auto')
  else if (recalled) appendEvent(state.neighbors, 'reopen')
  persistNeighbors(state.neighbors)
  state.section = 'neighbors'
  state.selected = targetId
  state.recipe = sanitizeRecipe({ ...defaultRecipe(), sectorsLayer: true, view: state.recipe.view }, state.inv)
  paint()
  renderStarters()
  if (kind === 'pin') showPinMeasureBar(lat, lng)
  else hideMeasureBar()
}

function startNeighbors(siteId) {
  const site = siteOf(siteId)
  if (!site) {
    logMsg(`No site ${siteId} in this inventory.`)
    return
  }
  const auto = tier1Candidates(state.inv, siteId)
  bootNeighborSession({
    kind: 'site',
    targetId: siteId,
    lat: v(site.lat),
    lng: v(site.lng),
    autoIds: auto.map((c) => c.cellId),
  })
  flyToSite(siteId)
}

function startNeighborsPin(lng, lat) {
  const auto = tier1CandidatesAt(state.inv, lat, lng)
  bootNeighborSession({
    kind: 'pin',
    targetId: PIN_ID,
    lat,
    lng,
    autoIds: auto.map((c) => c.cellId),
  })
  if (state.map) {
    const three = state.recipe.view === '3d'
    state.map.flyTo({
      center: [lng, lat],
      zoom: Math.max(state.map.getZoom(), three ? 15.2 : 14.6),
      pitch: three ? 68 : 0,
      duration: 700,
    })
  }
}

function toggleNeighborCell(cellId) {
  const n = state.neighbors
  if (!n) return
  const cell = state.inv.cells.find((c) => c.cell_id === cellId)
  if (!cell || (n.kind !== 'pin' && cell.site_id === n.targetId)) return
  if (n.auto.has(cellId)) {
    if (n.removed.has(cellId)) {
      n.removed.delete(cellId)
      appendEvent(n, 'restore', cellId)
    } else {
      n.removed.add(cellId)
      appendEvent(n, 'remove', cellId)
    }
  } else if (n.added.has(cellId)) {
    n.added.delete(cellId)
    appendEvent(n, 'unadd', cellId)
  } else {
    n.added.add(cellId)
    appendEvent(n, 'add', cellId)
  }
  persistNeighbors(n)
  paint()
}

function exportAudit(kind) {
  if (!state.neighbors) {
    logMsg('No neighbour session to export — select a site or drop a pin first.')
    return
  }
  persistNeighbors(state.neighbors)
  const payload = auditPayload(state.inv, state.neighbors)
  const stamp = (payload.key || 'nb').replace(/[^a-zA-Z0-9._-]+/g, '_')
  if (kind === 'csv') download(`nineone-gis-neighbors-${stamp}.csv`, auditCsv(state.inv, state.neighbors), 'text/csv')
  else download(`nineone-gis-neighbors-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json')
  logMsg(`Neighbour audit saved (${payload.monitored.length} monitored).`)
}

function logMsg(text: any, who = 'bot', opts: any = {}) {
  const panel = $('copilot')
  const log = $('log')
  if (!log) return
  const edge = log.scrollHeight - log.scrollTop - log.clientHeight
  const nearBottom = edge < 28
  if (panel && (who === 'user' || log.children.length || !panel.hidden)) panel.dataset.chat = '1'
  const div = document.createElement('div')
  div.className = `msg ${who}`
  const ts = opts.ts || Date.now()
  const meta = document.createElement('div')
  meta.className = 'msg-meta'
  const prov = opts.provenance ? ` · ${opts.provenance}` : ''
  meta.textContent = `${who === 'user' ? 'You' : 'Copilot'}${prov} · ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  const body = document.createElement('div')
  body.className = 'msg-body'
  body.textContent = String(text ?? '')
  div.appendChild(meta)
  div.appendChild(body)
  if (who === 'bot' && opts.provenance) {
    const rate = document.createElement('div')
    rate.className = 'msg-rate'
    const up = document.createElement('button')
    up.type = 'button'
    up.textContent = '+'
    up.title = 'Helpful'
    up.onclick = () => recordFeedback({ rating: 1, text: String(text ?? ''), route: opts.route || '', provenance: opts.provenance })
    const down = document.createElement('button')
    down.type = 'button'
    down.textContent = '−'
    down.title = 'Not helpful'
    down.onclick = () => recordFeedback({ rating: -1, text: String(text ?? ''), route: opts.route || '', provenance: opts.provenance })
    rate.append(up, down)
    div.appendChild(rate)
  }
  log.appendChild(div)
  if (opts.persist !== false) {
    persistChatEntry(text, who, ts)
  }
  void div.offsetHeight
  if (nearBottom || who === 'user') log.scrollTop = log.scrollHeight
  return div
}

async function typeBotMessage(text, speedMs = 10, metaOpts = {}) {
  const full = String(text ?? '')
  const ts = Date.now()
  const div = logMsg('', 'bot', { persist: false, ts, ...metaOpts })
  const body = div?.querySelector('.msg-body')
  if (!body) {
    persistChatEntry(full, 'bot', ts)
    return
  }
  setChatBusy(true, 'Responding...')
  let i = 0
  while (i < full.length) {
    i = Math.min(full.length, i + 2)
    body.textContent = full.slice(0, i)
    const log = $('log')
    if (log) log.scrollTop = log.scrollHeight
    await new Promise((resolve) => setTimeout(resolve, speedMs))
  }
  persistChatEntry(full, 'bot', ts)
}

function createStreamingBotMessage(metaOpts = {}) {
  const ts = Date.now()
  const div = logMsg('', 'bot', { persist: false, ts, ...metaOpts })
  const body = div?.querySelector('.msg-body')
  let full = ''
  return {
    append(delta) {
      const d = String(delta ?? '')
      if (!d) return
      full += d
      if (body) body.textContent = full
      const log = $('log')
      if (log) log.scrollTop = log.scrollHeight
    },
    finish() {
      persistChatEntry(full.trim(), 'bot', ts)
      return full.trim()
    },
  }
}

function hydrateChatLog() {
  const hist = readChatLog()
  if (!hist.length) return
  for (const m of hist) {
    if (!m || !m.text || !m.who) continue
    logMsg(m.text, m.who, { persist: false, ts: m.ts })
  }
}

function setChatBusy(busy, label = '') {
  state.chatBusy = !!busy
  const panel = $('copilot')
  if (panel) panel.dataset.busy = busy ? '1' : '0'
  const status = $('copilot-status')
  if (status) status.textContent = busy ? (label || 'Thinking...') : 'Ready'
  const askInput = $('ask')
  const runBtn = $('composer')?.querySelector('button[type="submit"]')
  if (askInput) askInput.disabled = false
  if (runBtn) (runBtn as HTMLButtonElement).disabled = busy
}

function speak(text) {
  if (!state.voiceOut || !window.speechSynthesis) return
  const clean = String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/EPSG:4326/gi, 'W G S 84')
    .replace(/TOK_/g, 'Tok ')
    .trim()
  if (!clean) return
  stopSpeaking()
  const voices = window.speechSynthesis.getVoices?.() || []
  const preferred =
    voices.find((v) => /en/i.test(v.lang) && /(natural|neural|siri|google|microsoft|aria|jenny|guy)/i.test(v.name)) ||
    voices.find((v) => /en/i.test(v.lang)) ||
    voices[0] ||
    null
  const u = new SpeechSynthesisUtterance(clean)
  if (preferred) u.voice = preferred
  u.lang = preferred?.lang || 'en-US'
  u.rate = 0.96
  u.pitch = 1.0
  u.volume = 1.0
  window.speechSynthesis.speak(u)
}

async function applyIntent(intent: any, opts: any = {}) {
  if (!intent || intent.type === 'empty') return
  intent = ensureFly(intent, state.inv)
  setCopilotOpen(true)
  if (intent.type === 'recipe' && intent.recipe) {
    const prevView = state.recipe.view
    const view = intent.recipe.view || prevView
    // A turn is a patch, not a reply: keys the turn does not mention survive.
    // Only an explicit reset ("back to overview") starts from defaults.
    const base = intent.reset ? defaultRecipe() : state.recipe
    state.recipe = sanitizeRecipe({ ...base, ...intent.recipe, view }, state.inv)
    // Toggling a layer must not destroy an in-progress tier-1 session.
    if (intent.reset || (intent.select && intent.select !== state.selected)) clearNeighbors()
    state.section = intent.reset ? null : (intent.section ?? state.section)
    if (intent.select) state.selected = intent.select
    paint()
    if (state.map && state.selected) setSelectedState(state.map, state.selected)
    document.querySelectorAll('[data-view]').forEach((b) => {
      const el = b as HTMLElement
      el.classList.toggle('on', el.dataset.view === state.recipe.view)
    })
    if (state.map && view !== prevView) {
      applyView(state.map, view)
      if (intent.fly) runCameraAction(() => executeFly(intent))
    } else if (intent.fly) {
      executeFly(intent)
    }
  } else if (intent.type === 'select') {
    select(intent.select ?? null)
  } else if (intent.type === 'neighbors' && intent.siteId) {
    startNeighbors(intent.siteId)
    intent.narrate = formatNeighborNarrate(state.inv, intent.siteId, state.neighbors)
  } else if (intent.type === 'drop') {
    setTool('drop')
  } else if (intent.type === 'audit') {
    exportAudit(intent.format || 'json')
  } else if (intent.type === 'qa') {
    if (intent.select) state.selected = intent.select
    else if (intent.site?.site_id) state.selected = intent.site.site_id
    if (state.selected) {
      paint()
      if (intent.fly === 'select') flyToSite(state.selected)
      else renderCard()
    }
  }
  if (!opts.skipNarrate) {
    const text = String(intent.narrate ?? '').trim() || 'I only handle map commands for this Tokyo RAN ingest. Try: sites in alarm, show drive test, tier-1 neighbours for TOK_001.'
    const prov = opts.provenance === 'model' ? 'model' : (opts.provenance === 'none' ? 'degraded' : 'local rule')
    const meta = { provenance: prov, route: opts.route || '' }
    setCopilotOpen(true)
    const instant = opts.route === 'local' || opts.provenance === 'inventory' || opts.provenance === 'none' || intent.type === 'neighbors' || intent.type === 'qa'
    if (instant) {
      logMsg(text, 'bot', meta)
      speak(text)
    } else {
      await typeBotMessage(text, 10, meta)
      speak(text)
    }
  }
  renderStarters()
  renderCopilotScope()
  placeCard()
}

async function ask(q, { voice = false } = {}) {
  const text = (q || '').trim()
  if (!text) return
  if (!state.inv) {
    logMsg('Map data still loading — try again in a moment.', 'bot', { provenance: 'degraded', route: 'error' })
    return
  }
  stopSpeaking()
  if (voice) state.voiceOut = true
  setCopilotOpen(true)
  logMsg(text, 'user')
  setChatBusy(true, 'Matching command…')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  try {
    let stream: any = null
    const metaOpts: any = { provenance: 'model', route: '' }
    const deadline = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Copilot timed out — try a quick prompt like "sites in alarm".')), 25000)
    })
    const { intent, streamed, meta }: any = await Promise.race([
      interpretWithStream(
      text,
      state.inv,
      state.selected,
      {
        section: state.section,
        onStage: (label) => setChatBusy(true, label),
        onDelta: (delta) => {
          if (!stream) {
            stream = createStreamingBotMessage({ provenance: 'model', route: meta?.route || 'openai-stream' })
            setChatBusy(true, 'Streaming answer…')
          }
          stream.append(delta)
        },
      },
    ),
      deadline,
    ])
    if (meta) {
      metaOpts.provenance = meta.provenance
      metaOpts.route = meta.route
    }
    if (streamed && stream) {
      const finalText = stream.finish()
      if (finalText) speak(finalText)
    }
    await applyIntent(intent, {
      skipNarrate: streamed,
      provenance: metaOpts.provenance,
      route: metaOpts.route,
    })
  } catch (err: any) {
    logMsg(`Copilot error: ${err?.message || String(err)}`, 'bot', { provenance: 'degraded', route: 'error' })
  } finally {
    setChatBusy(false)
  }
}

/**
 * #rail and #copilot slide rather than display:none, so their open state is a
 * class — [hidden] { display: none !important } cannot be transitioned. `inert`
 * keeps a closed panel out of the tab order and off the a11y tree.
 */
function isPanelOpen(id) {
  return !!$(id)?.classList.contains('open')
}

function setPanelOpen(id, open) {
  const el = $(id)
  if (!el) return
  el.classList.toggle('open', open)
  el.inert = !open
  el.setAttribute('aria-hidden', String(!open))
}

function placeCard() {
  const card = $('card')
  if (!card || card.hidden) return
  card.classList.toggle('beside-rail', isPanelOpen('rail'))
}

function setCopilotOpen(open) {
  const panel = $('copilot')
  if (!panel) return
  setPanelOpen('copilot', open)
  if (open && $('log')?.children.length) panel.dataset.chat = '1'
  const fab = $('copilot-fab')
  if (fab) {
    fab.classList.toggle('on', open)
    fab.setAttribute('aria-expanded', String(open))
    fab.title = open ? 'Close Copilot chat (C)' : 'Open Copilot chat (C)'
  }
  if (open) {
    $('ask')?.focus()
    setTimeout(() => {
      $('ask')?.focus()
      const log = $('log')
      if (log) log.scrollTop = log.scrollHeight
    }, 0)
  } else if (fab) {
    setTimeout(() => fab.focus(), 0)
  }
  placeCard()
}

function updateHud() {
  const c = state.cursor
  const z = state.map?.getZoom?.()
  const crs = state.inv?.crs || 'EPSG:4326'
  const selectedN = state.selected ? 1 : 0
  if ($('hud-crs')) $('hud-crs').textContent = `CRS ${crs}`
  if ($('hud-zoom')) $('hud-zoom').textContent = `Zoom ${z ? z.toFixed(2) : '—'}`
  if ($('hud-cursor')) {
    $('hud-cursor').textContent = c
      ? `Cursor ${c.lat.toFixed(5)} ${c.lng.toFixed(5)}`
      : 'Cursor —'
  }
  if ($('hud-selection')) $('hud-selection').textContent = `Selection ${selectedN}`
  if ($('hud-latency')) $('hud-latency').textContent = `Frame ${state.frameMs ? state.frameMs.toFixed(1) : '—'} ms`
  if ($('counts')) {
    $('counts').textContent = state.hud.counts
    $('counts').title = state.hud.countsTitle
  }
}

function toggle(id: string, show?: boolean) {
  const next = show === undefined ? !isPanelOpen(id) : !!show
  if (id === 'copilot') {
    setCopilotOpen(next)
    // Narrow viewports have room for one panel, not two.
    if (window.innerWidth < 960 && next) setPanelOpen('rail', false)
  } else {
    setPanelOpen(id, next)
    if (window.innerWidth < 960 && id === 'rail' && next) setCopilotOpen(false)
  }
  if (next) setFocusMode(false)
  placeCard()
}

/**
 * Focus mode: map only. Chrome fades and both panels collapse — leaving a 456px
 * chat over the map would defeat the point. The restore button and the basemap
 * attribution stay; nothing else does. F / C / \ bring it all back.
 */
function setFocusMode(on) {
  const next = !!on
  document.body.classList.toggle('focus', next)
  $('btn-focus')?.setAttribute('aria-pressed', String(next))
  if (next) {
    setPanelOpen('rail', false)
    setCopilotOpen(false)
    placeCard()
    // setCopilotOpen parks focus on the FAB, which focus mode has just faded out.
    setTimeout(() => $('focus-exit')?.focus(), 0)
  }
}

function bindVoice() {
  const btn = $('btn-mic')
  const Speech = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!Speech) {
    btn.disabled = true
    btn.title = 'Voice needs Chrome or Edge'
    return
  }
  const rec = new Speech()
  state.voiceRec = rec
  rec.lang = 'en-US'
  rec.interimResults = false
  rec.continuous = false
  rec.onstart = () => {
    stopSpeaking()
    if (!state.voiceGreeted) {
      logMsg('Hi, I am Copilot. Tell me what you want to check, for example: daily drive test near TOK_NEW_03.')
      state.voiceGreeted = true
      speak('Hi, I am Copilot. I am listening. You can say, daily drive test near Tok New zero three.')
    } else {
      speak('I am listening.')
    }
  }
  rec.onresult = (e) => {
    const text = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim()
    if (!text) return
    $('ask').value = text
    enqueueAsk(text, { voice: true })
  }
  rec.onerror = (e) => {
    btn.classList.remove('on')
    if (e.error !== 'aborted' && e.error !== 'no-speech') logMsg(`Mic: ${e.error}`)
  }
  rec.onend = () => btn.classList.remove('on')
  btn.onclick = () => {
    setCopilotOpen(true)
    if (btn.classList.contains('on')) {
      stopVoiceCapture()
      stopSpeaking()
      return
    }
    state.voiceOut = true
    btn.classList.add('on')
    try { rec.start() } catch { rec.stop(); rec.start() }
  }
}

function bindSearch() {
  const input = $('search')
  const box = $('typeahead')
  const render = () => {
    const hits = searchHits(state.inv, input.value)
    if (!hits.length) { box.hidden = true; return }
    box.hidden = false
    box.innerHTML = hits.map((h) => `<button type="button" data-id="${h.siteId}"><b>${h.title}</b><div class="meta">${h.meta}</div></button>`).join('')
    box.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { select(b.dataset.id); box.hidden = true; input.value = '' }
    })
  }
  input.addEventListener('input', render)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const hits = searchHits(state.inv, input.value, 1)
      if (hits[0]) { select(hits[0].siteId); box.hidden = true }
    }
    if (e.key === 'Escape') box.hidden = true
  })
}

function hideMeasureBar() {
  const el = $('measure')
  if (!el) return
  el.hidden = true
  el.classList.remove('armed')
  el.textContent = ''
  if (state.map) setMeasureData(state.map, null)
}

function showPinMeasureBar(lat, lng) {
  const el = $('measure')
  if (!el) return
  el.hidden = false
  el.classList.remove('armed')
  el.textContent = `Candidate ${lat.toFixed(5)} N ${lng.toFixed(5)} E — click sectors to add or remove`
}

function setTool(name) {
  state.tool = name
  state.measurePts = []
  document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === name))
  if (state.map) {
    state.map.__tool = name
    state.map.getCanvas().style.cursor = name === 'drop' ? 'crosshair' : ''
    setMeasureData(state.map, null)
    setProbeData(state.map, null)
  }
  if (name === 'drop') {
    $('measure').hidden = false
    $('measure').classList.add('armed')
    $('measure').textContent = 'Click the map to place a candidate rooftop'
  } else {
    hideMeasureBar()
  }
}

function bindTools() {
  document.querySelectorAll('.tool[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool))
  })
  $('basemap').addEventListener('change', () => {
    document.body.classList.toggle('map-dark', onDarkBasemap())
    setBasemap(state.map, $('basemap').value, () => paint())
  })
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.recipe.view = btn.dataset.view
      document.querySelectorAll('[data-view]').forEach((b) => {
        const el = b as HTMLElement
        el.classList.toggle('on', el.dataset.view === state.recipe.view)
      })
      applyView(state.map, state.recipe.view)
      paint()
      recipeHash()
    })
  })
  $('btn-import').onclick = () => $('file-import').click()
  $('file-import').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      state.userFc = parseImport(await file.text(), file.name)
      setUserData(state.map, state.userFc)
      logMsg(`Imported ${state.userFc.features.length} features.`)
    } catch (err: any) {
      logMsg(`Import failed: ${err?.message || err}`)
    }
  })
  const exportExtras = () => ({
    neighborLines: state.neighbors ? neighborLines(state.inv, state.neighbors, monitoredIds(state.neighbors)) : null,
    candidateFc: candidateFc(state.neighbors),
    holes: state.holesFc,
    dtPaths: state.dtPaths,
    dtPreview: state.dtPreview,
  })
  $('btn-geojson').onclick = () => {
    const extras = exportExtras()
    download('nineone-gis.geojson', JSON.stringify(layersToGeoJSON(visibleLayers(state.geo, state.recipe, state.userFc, extras)), null, 2), 'application/geo+json')
    logMsg('GeoJSON exports vector layers. Groundhog and DT sample points remain GPU-only; DT routes are included when enabled.')
  }
  $('btn-kml').onclick = () => {
    const extras = exportExtras()
    download('nineone-gis.kml', layersToKml(visibleLayers(state.geo, state.recipe, state.userFc, extras)), 'application/vnd.google-earth.kml+xml')
    logMsg('KML exports vector layers. Groundhog and DT sample points remain GPU-only; DT routes are included when enabled.')
  }
  $('btn-shot').onclick = async () => {
    try {
      recipeHash()
      const png = await snapshotCanvas(state.map)
      downloadPng(png, 'nineone-gis.png')
      navigator.clipboard?.writeText(location.href)
      logMsg('Snapshot saved. Recipe URL copied.')
    } catch (err: any) {
      logMsg(`Snapshot failed: ${err?.message || String(err)}`)
    }
  }
}

function onMapClick(e) {
  if (state.tool === 'ruler' || state.tool === 'radius') {
    const p = [e.lngLat.lng, e.lngLat.lat]
    state.measurePts.push(p)
    if (state.measurePts.length === 1) {
      $('measure').hidden = false
      $('measure').textContent = 'Second point'
      return
    }
    const res = state.tool === 'ruler'
      ? measureDistance(state.measurePts[0], state.measurePts[1])
      : measureRadius(state.measurePts[0], state.measurePts[1])
    setMeasureData(state.map, res.fc)
    $('measure').hidden = false
    $('measure').textContent = res.label
    state.measurePts = []
    return
  }
  if (state.tool === 'drop') {
    startNeighborsPin(e.lngLat.lng, e.lngLat.lat)
    setTool('pan')
    showPinMeasureBar(e.lngLat.lat, e.lngLat.lng)
    return
  }
  const hit = queryHit(state.map, e)
  if (hit?.cluster) {
    const src = state.map.getSource('sites')
    src.getClusterExpansionZoom(hit.clusterId, (err, zoom) => {
      if (err) return
      state.map.easeTo({ center: hit.lngLat, zoom })
    })
    return
  }
  if (state.section === 'neighbors' && hit?.cellId && (hit.source === 'sectors' || hit.source === 'neighbors')) {
    // The target's own lobes aren't toggleable — fall through so the click still
    // selects, rather than being swallowed into a no-op.
    const cell = state.inv.cells.find((c) => c.cell_id === hit.cellId)
    if (cell && cell.site_id !== state.neighbors?.targetId) {
      toggleNeighborCell(hit.cellId)
      return
    }
  }
  if (hit?.siteId) {
    setProbeData(state.map, null)
    setPicker(null)
    select(hit.siteId)
    return
  }
  const desc = describePick(pickPoint(state.map, e.point), state.heavy)
  if (desc) {
    setProbeData(state.map, { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [desc.lng, desc.lat] } }] })
    setPicker({ lng: desc.lng, lat: desc.lat })
    return
  }
  // Empty ground: pin the picker there rather than only clearing selection.
  setProbeData(state.map, { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [e.lngLat.lng, e.lngLat.lat] } }] })
  setPicker(e.lngLat)
  select(null)
}

async function boot() {
  const inv = await loadInventory()
  state.inv = inv
  const [{ gh, dt }, dtPaths] = await Promise.all([loadHeavy(inv), loadDtPaths(inv)])
  state.heavy = { gh, dt }
  state.dtPaths = dtPaths
  state.dtPreview = buildDtPreview(dt)
  state.holesFc = buildHoles(gh)
  const cam = loadHash()
    document.querySelectorAll('[data-view]').forEach((b) => {
      const el = b as HTMLElement
      el.classList.toggle('on', el.dataset.view === state.recipe.view)
    })
  let booted = false
  const finish = () => {
    if (booted) { paint(); return }
    booted = true
    paint()
    state.map.resize()
    if (cam?.center) {
      state.map.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing })
    }
    const clk = inv.clock
    if ($('clock-label')) {
      $('clock-label').textContent = clk?.t
        ? `${clk.t} ← ${clk.source}`
        : 'cell-plan snapshot'
    }
    updateHud()
    renderStarters()
  }
  state.map = createMap($('map'), { view: state.recipe.view, onLoad: finish })
  window.__map = state.map
  // Debug handle, alongside __map / __paintErr — lets a console or a smoke test
  // read the live recipe without scraping the DOM.
  window.__state = state
  setTimeout(() => { if (!booted) finish() }, 1200)
  let lastRender = performance.now()
  state.map.on('render', () => {
    const now = performance.now()
    state.frameMs = now - lastRender
    lastRender = now
    updateHud()
  })
  state.map.on('mousemove', (e) => {
    state.cursor = { lat: e.lngLat.lat, lng: e.lngLat.lng }
    updateHud()
  })
  state.map.on('click', onMapClick)
  // The picker is pinned to the ground, so it has to be re-projected on every
  // camera frame — that is what makes it read as stuck to the map.
  state.map.on('move', () => { if (state.picker) renderPicker() })
  state.map.on('moveend', () => recipeHash())
  // Lobes hold a constant on-screen size, so their geometry follows the zoom.
  state.map.on('zoom', queueSectorRepaint)
  state.map.on('zoomend', () => {
    const z = state.map.getZoom()
    const crossed = (state.__z < 10) !== (z < 10)
    state.__z = z
    // buildGeo emits no sectors below z10, so crossing that line needs a full repaint.
    if (crossed) paint()
    else queueSectorRepaint()
  })
  new ResizeObserver(() => state.map?.resize()).observe($('stage'))

  document.body.classList.toggle('map-dark', onDarkBasemap())
  bindSearch()
  bindTools()
  bindVoice()
  hydrateChatLog()
  setChatBusy(false)
  setAskQueue(Promise.resolve())
  window.addEventListener('unhandledrejection', () => setChatBusy(false))
  const submitAsk = (fromVoice = false) => {
    const input = $('ask')
    if (!input) return
    const q = input.value.trim()
    if (!q) return
    input.value = ''
    enqueueAsk(q, { voice: fromVoice })
  }
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault()
    submitAsk()
  })
  const runBtn = $('composer')?.querySelector('button[type="submit"]')
  if (runBtn) runBtn.addEventListener('click', (e) => { e.preventDefault(); submitAsk() })
  $('ask').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      if (state.chatBusy && !window.getSelection()?.toString()) {
        stopSpeaking()
        stopVoiceCapture()
        setChatBusy(false)
        setAskQueue(Promise.resolve())
      }
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitAsk()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setCopilotOpen(false)
    }
  })
  $('btn-rail').onclick = () => toggle('rail')
  if ($('copilot-fab')) $('copilot-fab').onclick = () => toggle('copilot')
  $('rail-x').onclick = () => { setPanelOpen('rail', false); placeCard() }
  if ($('btn-focus')) $('btn-focus').onclick = () => setFocusMode(!document.body.classList.contains('focus'))
  if ($('focus-exit')) $('focus-exit').onclick = () => setFocusMode(false)
  bindLayerRail()
  $('copilot-x').onclick = () => setCopilotOpen(false)
  if ($('copilot-clear')) $('copilot-clear').onclick = () => {
    stopSpeaking()
    stopVoiceCapture()
    state.voiceOut = false
    const log = $('log')
    if (log) log.innerHTML = ''
    clearChatLog()
    const panel = $('copilot')
    if (panel) panel.dataset.chat = '0'
    setChatBusy(false)
    renderStarters()
  }
  if ($('copilot-reset-memory')) $('copilot-reset-memory').onclick = () => {
    enqueueAsk('reset memory')
  }
  setCopilotOpen(false)

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null
    if (target?.matches('input, textarea, select')) {
      if (e.key === 'Escape') target.blur()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === '/') { e.preventDefault(); $('search').focus() }
    if (e.key === 'f' || e.key === 'F') toggle('rail')
    if (e.key === 'c' || e.key === 'C') toggle('copilot')
    if (e.key === '\\') { e.preventDefault(); setFocusMode(!document.body.classList.contains('focus')) }
    if (e.key === 'Escape') { setFocusMode(false); clearNeighbors(); state.selected = null; state.section = null; setPanelOpen('rail', false); setCopilotOpen(false); hideMeasureBar(); setPicker(null); setProbeData(state.map, null); paint(); renderStarters() }
  })
}

let bootPromise = null

export function bootLegacyApp() {
  const mapEl = document.getElementById('map')
  const live = state.map?.getContainer?.()
  if (bootPromise && live && mapEl && live === mapEl) return bootPromise
  bootPromise = boot().catch((err) => {
    bootPromise = null
    document.body.innerHTML = `<p style="padding:24px;color:#eee">Failed to load inventory.json. Run product/db/ingest.py. ${err}</p>`
    throw err
  })
  return bootPromise
}
