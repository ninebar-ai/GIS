import { v, buildGeo, buildPlanned } from './lobes.js'
import { defaultRecipe, applyRecipe, counts, chipList, dismissChip, renderFacets } from './filters.js'
import { createMap, dressAndPaint, setMeasureData, setUserData, setProbeData, queryHit, setBasemap, visibleLayers, applyView, setSelectedState } from './map.js?v=27'
import { searchHits, measureDistance, measureRadius, layersToGeoJSON, layersToKml, download, parseImport, snapshotCanvas, downloadPng } from './tools.js?v=27'
import { interpretWithStream, contextChips, getUserId } from './chat.js?v=37'
import { loadPacked, pickPoint, describePick } from './heavy.js'
import { buildHoles } from './holes.js'
import { tier1Candidates, tier1CandidatesAt, monitoredIds, neighborLines, candidateFc, PIN_ID, sessionKey, persistNeighbors, recallNeighbors, applyRecall, appendEvent, auditPayload, auditCsv } from './neighbors.js'

const $ = (id) => document.getElementById(id)

const state = {
  inv: null,
  recipe: defaultRecipe(),
  selected: null,
  section: null,
  neighbors: null,
  tool: 'pan',
  measurePts: [],
  userFc: { type: 'FeatureCollection', features: [] },
  geo: null,
  map: null,
  voiceOut: false,
  cursor: null,
  frameMs: null,
  dtPaths: { type: 'FeatureCollection', features: [] },
  dtPreview: { type: 'FeatureCollection', features: [] },
  voiceGreeted: false,
  chatBusy: false,
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
  state.geo = buildGeo(sites, cells, { bandPin, selectedId: state.selected, bounds, zoom, keepIds: neighborIds })
  state.geo.plannedFc = buildPlanned(state.inv.sites)
  if (state.map) {
    dressAndPaint(state.map, state.geo, state.recipe, {
      gh: state.heavy?.gh,
      dt: state.heavy?.dt,
      dtPaths: state.dtPaths,
      dtPreview: state.dtPreview,
      selectedId: state.selected,
      holes: state.holesFc,
      neighborIds,
      neighborLines: nbLines,
      candidateFc: pinFc,
    })
  }
  const c = counts(state.inv, state.recipe)
  const gpu = (state.heavy?.gh?.n || c.gh) + (state.heavy?.dt?.n || c.dt)
  $('counts').textContent = `${c.sites} sites · ${c.cells} cells · ${c.alarm} in alarm · GPU ${gpu.toLocaleString()}`
  renderFacets($('facets'), state.inv, state.recipe, (next) => {
    state.recipe = next
    paint()
    recipeHash()
  })
  renderContextStrip()
  renderChips()
  renderCard()
  updateHud()
  recipeHash()
}

function renderContextStrip() {
  const label = $('context-label')
  const box = $('context-actions')
  if (!label || !box) return
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

function renderStarters() {
  const chips = contextChips({ section: state.section, selected: state.selected, inv: state.inv })
  $('starters').innerHTML = chips.map((s) => {
    const label = String(s.label ?? s).replace(/</g, '&lt;')
    const ask = String(s.ask ?? s).replace(/"/g, '&quot;')
    const hint = s.hint ? `<span class="starter-hint">${String(s.hint).replace(/</g, '&lt;')}</span>` : ''
    return `<button type="button" class="starter" data-ask="${ask}"><span class="starter-label">${label}</span>${hint}</button>`
  }).join('')
  $('starters').querySelectorAll('button').forEach((b) => {
    b.onclick = () => ask(b.dataset.ask)
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

function flyToSite(id) {
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
    zoom: Math.max(state.map.getZoom(), three ? 15.2 : 14.6),
    pitch: three ? 68 : 0,
    duration: 900,
  })
}

function flySet(pred) {
  const pts = state.inv.sites
    .filter(pred)
    .map((s) => [Number(v(s.lng)), Number(v(s.lat))])
    .filter((p) => validJapanCoord(p[0], p[1]))
  if (!pts.length) return
  const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]))
  state.map.fitBounds(b, { padding: 90, duration: 900, maxZoom: 15, pitch: state.recipe.view === '3d' ? 58 : 0 })
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
}

function bootNeighborSession({ kind, targetId, lat, lng, autoIds, restored }) {
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
  state.recipe = { ...state.recipe, sectorsLayer: true }
  paint()
  renderStarters()
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
  if (kind === 'csv') download(`ns-qaw-a-neighbors-${stamp}.csv`, auditCsv(state.inv, state.neighbors), 'text/csv')
  else download(`ns-qaw-a-neighbors-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json')
  logMsg(`Neighbour audit saved (${payload.monitored.length} monitored).`)
}

function logMsg(text, who = 'bot', opts = {}) {
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
  meta.textContent = `${who === 'user' ? 'You' : 'Copilot'} · ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  const body = document.createElement('div')
  body.className = 'msg-body'
  body.textContent = String(text ?? '')
  div.appendChild(meta)
  div.appendChild(body)
  log.appendChild(div)
  if (opts.persist !== false) {
    persistChatEntry(text, who, ts)
  }
  // Force layout flush so a just-submitted user prompt paints immediately.
  // This avoids "message N shows after message N+1" on some event loops.
  void div.offsetHeight
  if (nearBottom || who === 'user') log.scrollTop = log.scrollHeight
  return div
}

async function typeBotMessage(text, speedMs = 10) {
  const full = String(text ?? '')
  const ts = Date.now()
  const div = logMsg('', 'bot', { persist: false, ts })
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

function createStreamingBotMessage() {
  const ts = Date.now()
  const div = logMsg('', 'bot', { persist: false, ts })
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
  if (runBtn) runBtn.disabled = busy
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
  const voices = window.speechSynthesis.getVoices?.() || []
  const preferred =
    voices.find((v) => /en/i.test(v.lang) && /(natural|neural|siri|google|microsoft|aria|jenny|guy)/i.test(v.name)) ||
    voices.find((v) => /en/i.test(v.lang)) ||
    voices[0] ||
    null
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(clean)
  if (preferred) u.voice = preferred
  u.lang = preferred?.lang || 'en-US'
  u.rate = 0.96
  u.pitch = 1.0
  u.volume = 1.0
  window.speechSynthesis.speak(u)
}

async function applyIntent(intent, opts = {}) {
  if (!intent || intent.type === 'empty') return
  setCopilotOpen(true)
  if (intent.type === 'recipe' && intent.recipe) {
    const prevView = state.recipe.view
    const view = intent.recipe.view || prevView
    state.recipe = { ...defaultRecipe(), ...intent.recipe, view }
    clearNeighbors()
    state.section = intent.section ?? null
    if (intent.select) state.selected = intent.select
    paint()
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === state.recipe.view))
    if (state.map && view !== prevView) applyView(state.map, view)
    if (intent.fly === 'planned') flySet((s) => v(s.status) === 'planned')
    else if (intent.fly === 'alarms') flySet((s) => s.in_alarm)
    else if (intent.fly === 'select') flyToSite(state.selected)
    else if (intent.fly === 'dt' || intent.fly === 'dt-focus') flyDtFocus(state.heavy?.dt?.bbox || state.inv.drive_test?.bbox)
    else if (intent.fly === 'dt-near') flyDtNearSelection()
    else if (intent.fly === 'gh') flyBbox(state.heavy?.gh?.bbox || state.inv.groundhog?.bbox)
    else if (intent.fly === 'cluster') cinematic()
  } else if (intent.type === 'select') {
    select(intent.select ?? null)
  } else if (intent.type === 'neighbors' && intent.siteId) {
    startNeighbors(intent.siteId)
  } else if (intent.type === 'drop') {
    setTool('drop')
  } else if (intent.type === 'audit') {
    exportAudit(intent.format || 'json')
  } else if (intent.type === 'qa') {
    if (intent.select) state.selected = intent.select
    else if (intent.site?.site_id) state.selected = intent.site.site_id
    if (state.selected) paint()
    if (intent.fly === 'select' && state.selected) flyToSite(state.selected)
  }
  if (intent.narrate && !opts.skipNarrate) {
    await typeBotMessage(intent.narrate)
    speak(intent.narrate)
  }
  renderStarters()
  placeCard()
}

async function ask(q) {
  const text = (q || '').trim()
  if (!text) return
  setCopilotOpen(true)
  logMsg(text, 'user')
  setChatBusy(true, 'Thinking...')
  // Yield one frame so the user prompt is visible before intent work starts.
  await new Promise((resolve) => requestAnimationFrame(() => resolve()))
  try {
    let stream = null
    const { intent, streamed } = await interpretWithStream(
      text,
      state.inv,
      state.selected,
      (delta) => {
        if (!stream) {
          stream = createStreamingBotMessage()
          setChatBusy(true, 'Responding...')
        }
        stream.append(delta)
      },
    )
    if (streamed && stream) {
      const finalText = stream.finish()
      if (finalText) speak(finalText)
    }
    await applyIntent(intent, { skipNarrate: streamed })
  } catch (err) {
    logMsg(`Copilot error: ${err?.message || String(err)}`)
  } finally {
    setChatBusy(false)
  }
}

function placeCard() {
  const card = $('card')
  if (!card || card.hidden) return
  card.classList.toggle('beside-rail', !$('rail').hidden)
}

function setCopilotOpen(open) {
  const panel = $('copilot')
  if (!panel) return
  panel.hidden = !open
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
}

function toggle(id, show) {
  if (id === 'copilot') {
    const next = show === undefined ? $('copilot')?.hidden : !!show
    setCopilotOpen(next)
    if (window.innerWidth < 960 && next) $('rail').hidden = true
    return
  }
  const el = $(id)
  if (show === undefined) el.hidden = !el.hidden
  else el.hidden = !show
  if (window.innerWidth < 960) {
    if (id === 'rail' && !el.hidden) setCopilotOpen(false)
  }
  placeCard()
}

function bindVoice() {
  const btn = $('btn-mic')
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Speech) {
    btn.disabled = true
    btn.title = 'Voice needs Chrome or Edge'
    return
  }
  const rec = new Speech()
  rec.lang = 'en-US'
  rec.interimResults = false
  rec.continuous = false
  rec.onstart = () => {
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
    state.voiceOut = true
    ask(text)
  }
  rec.onerror = (e) => {
    btn.classList.remove('on')
    if (e.error !== 'aborted' && e.error !== 'no-speech') logMsg(`Mic: ${e.error}`)
  }
  rec.onend = () => btn.classList.remove('on')
  btn.onclick = () => {
    setCopilotOpen(true)
    if (btn.classList.contains('on')) {
      rec.stop()
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
    $('measure').hidden = true
    $('measure').classList.remove('armed')
  }
}

function bindTools() {
  document.querySelectorAll('.tool[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool))
  })
  $('basemap').addEventListener('change', () => {
    setBasemap(state.map, $('basemap').value, () => paint())
  })
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.recipe.view = btn.dataset.view
      document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === state.recipe.view))
      applyView(state.map, state.recipe.view)
      paint()
      recipeHash()
    })
  })
  $('btn-import').onclick = () => $('file-import').click()
  $('file-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      state.userFc = parseImport(await file.text(), file.name)
      setUserData(state.map, state.userFc)
      logMsg(`Imported ${state.userFc.features.length} features.`)
    } catch (err) {
      logMsg(`Import failed: ${err.message}`)
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
    download('ns-qaw-a.geojson', JSON.stringify(layersToGeoJSON(visibleLayers(state.geo, state.recipe, state.userFc, extras)), null, 2), 'application/geo+json')
    logMsg('GeoJSON exports vector layers. Groundhog and DT sample points remain GPU-only; DT routes are included when enabled.')
  }
  $('btn-kml').onclick = () => {
    const extras = exportExtras()
    download('ns-qaw-a.kml', layersToKml(visibleLayers(state.geo, state.recipe, state.userFc, extras)), 'application/vnd.google-earth.kml+xml')
    logMsg('KML exports vector layers. Groundhog and DT sample points remain GPU-only; DT routes are included when enabled.')
  }
  $('btn-shot').onclick = async () => {
    try {
      recipeHash()
      const png = await snapshotCanvas(state.map)
      downloadPng(png, 'ns-qaw-a.png')
      navigator.clipboard?.writeText(location.href)
      logMsg('Snapshot saved. Recipe URL copied.')
    } catch (err) {
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
    $('measure').hidden = false
    $('measure').classList.remove('armed')
    $('measure').textContent = `Candidate ${e.lngLat.lat.toFixed(5)} N ${e.lngLat.lng.toFixed(5)} E — click sectors to add or remove`
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
    select(hit.siteId)
    return
  }
  const desc = describePick(pickPoint(state.map, e.point), state.heavy)
  if (desc) {
    setProbeData(state.map, { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [desc.lng, desc.lat] } }] })
    $('measure').hidden = false
    $('measure').textContent = `${desc.kind} · ${desc.rsrp.toFixed(1)} dBm · ${desc.lat.toFixed(5)} N ${desc.lng.toFixed(5)} E ← ${desc.source}`
    return
  }
  setProbeData(state.map, null)
  select(null)
}

async function boot() {
  const inv = await fetch('./inventory.json').then((r) => r.json())
  state.inv = inv
  const [gh, dt, dtPaths] = await Promise.all([
    loadPacked(inv.groundhog?.file ? `./${inv.groundhog.file}` : './gh.bin'),
    loadPacked(inv.drive_test?.file ? `./${inv.drive_test.file}` : './dt.bin'),
    inv.drive_test_paths?.file
      ? fetch(`./${inv.drive_test_paths.file}`).then((r) => (r.ok ? r.json() : { type: 'FeatureCollection', features: [] }))
      : Promise.resolve({ type: 'FeatureCollection', features: [] }),
  ])
  state.heavy = { gh, dt }
  state.dtPaths = dtPaths
  state.dtPreview = buildDtPreview(dt)
  state.holesFc = buildHoles(gh)
  const cam = loadHash()
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === state.recipe.view))
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
  state.map.on('moveend', () => recipeHash())
  state.map.on('zoomend', () => {
    const z = state.map.getZoom()
    const crossed = (state.__z < 10) !== (z < 10)
    state.__z = z
    if (crossed) paint()
  })
  new ResizeObserver(() => state.map?.resize()).observe($('stage'))

  bindSearch()
  bindTools()
  bindVoice()
  hydrateChatLog()
  let askQueue = Promise.resolve()
  const submitAsk = () => {
    const input = $('ask')
    if (!input) return
    const q = input.value.trim()
    input.value = ''
    askQueue = askQueue.then(() => ask(q)).catch((err) => {
      logMsg(`Copilot error: ${err?.message || String(err)}`)
    })
  }
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault()
    submitAsk()
  })
  const runBtn = $('composer')?.querySelector('button[type="submit"]')
  if (runBtn) runBtn.addEventListener('click', (e) => { e.preventDefault(); submitAsk() })
  $('ask').addEventListener('keydown', (e) => {
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
  if ($('btn-copilot')) $('btn-copilot').onclick = () => toggle('copilot')
  if ($('copilot-fab')) $('copilot-fab').onclick = () => toggle('copilot')
  $('rail-x').onclick = () => { $('rail').hidden = true; placeCard() }
  $('copilot-x').onclick = () => setCopilotOpen(false)
  if ($('copilot-clear')) $('copilot-clear').onclick = () => {
    const log = $('log')
    if (log) log.innerHTML = ''
    clearChatLog()
    const panel = $('copilot')
    if (panel) panel.dataset.chat = '0'
    setChatBusy(false)
    renderStarters()
  }
  if ($('copilot-reset-memory')) $('copilot-reset-memory').onclick = () => {
    askQueue = askQueue.then(() => ask('reset memory')).catch((err) => {
      logMsg(`Copilot error: ${err?.message || String(err)}`)
      setChatBusy(false)
    })
  }
  setCopilotOpen(false)

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) {
      if (e.key === 'Escape') e.target.blur()
      return
    }
    if (e.key === '/') { e.preventDefault(); $('search').focus() }
    if (e.key === 'f' || e.key === 'F') toggle('rail')
    if (e.key === 'c' || e.key === 'C') toggle('copilot')
    if (e.key === 'Escape') { clearNeighbors(); state.selected = null; state.section = null; $('rail').hidden = true; setCopilotOpen(false); $('measure').hidden = true; setProbeData(state.map, null); paint(); renderStarters() }
  })
}

boot().catch((err) => {
  document.body.innerHTML = `<p style="padding:24px;color:#eee">Failed to load inventory.json. Run ingest.py. ${err}</p>`
})
