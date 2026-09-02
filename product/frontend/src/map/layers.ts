import { paintHeavy, COLOR_STOPS } from '../heavy'
import { enhance3d } from './basemap'
import { setNeighborState, setSelectedState } from './interaction'
import { emptyFc, ensureSources } from './sources'

function addLayer(map, spec) {
  try {
    if (!map.getLayer(spec.id)) map.addLayer(spec)
  } catch { /* */ }
}

function vis(on) {
  return on ? 'visible' : 'none'
}

function ensureLayers(map: any, recipe: any = {}) {
  const three = recipe.view === '3d'
  const dark = !!map.__dark
  addLayer(map, {
    id: 'sites-cluster', type: 'circle', source: 'sites',
    filter: ['has', 'point_count'],
    maxzoom: 10,
    paint: {
      'circle-color': dark ? '#DCD8CE' : '#1A1612',
      'circle-radius': ['step', ['get', 'point_count'], 10, 20, 14, 100, 18, 1000, 24],
      'circle-stroke-width': 1.4,
      'circle-stroke-color': dark ? '#0B0F13' : '#FBF9F5',
      'circle-opacity': 0.92,
    },
  })
  addLayer(map, {
    id: 'sites-cluster-count', type: 'symbol', source: 'sites',
    filter: ['has', 'point_count'],
    maxzoom: 10,
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
    },
    paint: { 'text-color': dark ? '#0B0F13' : '#FBF9F5' },
  })
  addLayer(map, {
    id: 'sites-glow', type: 'circle', source: 'sites',
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'in_alarm'], 1]],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 15, 18],
      'circle-color': '#A9433A',
      'circle-opacity': 0.28,
      'circle-blur': 0.75,
      'circle-pitch-alignment': 'map',
    },
  })
  addLayer(map, {
    id: 'sites', type: 'circle', source: 'sites',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        5, 2.6, 10, 5.5, 15, 7.2,
      ],
      'circle-color': ['get', 'color'],
      'circle-pitch-alignment': 'map',
      'circle-stroke-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 3.4,
        ['boolean', ['feature-state', 'hover'], false], 2.6,
        ['==', ['get', 'in_alarm'], 1], 2.2,
        1,
      ],
      'circle-stroke-color': dark ? '#0B0F13' : '#FBF9F5',
      'circle-opacity': 0.95,
    },
  })
  addLayer(map, {
    id: 'planned-ring', type: 'circle', source: 'planned',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 15, 16],
      'circle-color': '#9A7614',
      'circle-opacity': 0.12,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#D6AE45',
      'circle-pitch-alignment': 'map',
    },
  })
  addLayer(map, {
    id: 'candidate-ring', type: 'circle', source: 'candidate',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 14, 15, 22],
      'circle-color': '#4FBDB6',
      'circle-opacity': 0.14,
      'circle-stroke-width': 2.2,
      'circle-stroke-color': '#4FBDB6',
      'circle-pitch-alignment': 'map',
    },
  })
  addLayer(map, {
    id: 'candidate-pin', type: 'circle', source: 'candidate',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 9],
      'circle-color': '#4FBDB6',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FBF9F5',
      'circle-pitch-alignment': 'map',
    },
  })
  addLayer(map, {
    id: 'dt-preview', type: 'circle', source: 'dt-preview',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 12, 2.2, 16, 3.3],
      'circle-color': '#1f5f8f',
      'circle-opacity': 0.78,
      'circle-stroke-width': 0.8,
      'circle-stroke-color': '#f6f8fb',
      'circle-stroke-opacity': 0.88,
    },
    layout: { visibility: recipe.dtLayer ? 'visible' : 'none' },
  })
  addLayer(map, {
    id: 'dt-path', type: 'line', source: 'dt-paths',
    paint: {
      'line-color': '#3E6180',
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 12, 2.6, 16, 3.8],
      'line-opacity': 0.92,
    },
    layout: { visibility: recipe.dtLayer ? 'visible' : 'none' },
  })
  addLayer(map, {
    id: 'holes', type: 'fill', source: 'holes',
    minzoom: 11,
    paint: {
      'fill-color': '#A9433A',
      'fill-opacity': 0.18,
      'fill-outline-color': '#7a2e28',
    },
  })
  // Dots z<10. Wedge fill z10–15 (and z>15 in 2D). Outline same range.
  addLayer(map, {
    id: 'sectors', type: 'fill', source: 'sectors',
    minzoom: 10,
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 0.62,
        ['boolean', ['feature-state', 'neighbor'], false], 0.55,
        ['boolean', ['feature-state', 'hover'], false], 0.46,
        0.34,
      ],
    },
  })
  addLayer(map, {
    id: 'sectors-line', type: 'line', source: 'sectors',
    minzoom: 10,
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'neighbor'], false], '#EE9A3B', ['get', 'color']],
      'line-width': ['case', ['boolean', ['feature-state', 'neighbor'], false], 2.4, 1.6],
      'line-opacity': 0.85,
    },
  })
  addLayer(map, {
    id: 'neighbors-line', type: 'line', source: 'neighbors',
    paint: { 'line-color': '#EE9A3B', 'line-width': 2, 'line-dasharray': [2, 1.4], 'line-opacity': 0.85 },
  })
  // 3D beam z>15 only when 3D view has earned its place.
  addLayer(map, {
    id: 'sectors-3d', type: 'fill-extrusion', source: 'sectors',
    minzoom: 15,
    layout: { visibility: vis(three) },
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-height': ['coalesce', ['get', 'beam_height_m'], 48],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.46,
      'fill-extrusion-vertical-gradient': true,
    },
  })
  addLayer(map, {
    id: 'spider', type: 'line', source: 'spider', minzoom: 14,
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.15, 'line-dasharray': [1.1, 1.3], 'line-opacity': 0.75 },
  })
  addLayer(map, {
    id: 'labels', type: 'symbol', source: 'labels', minzoom: 14.4,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-font': ['Noto Sans Regular'],
      'text-pitch-alignment': 'viewport',
      'text-optional': true,
      'text-padding': 4,
      'text-allow-overlap': false,
    },
    paint: dark
      ? { 'text-color': '#EDEAE3', 'text-halo-color': '#0B0F13', 'text-halo-width': 1.3 }
      : { 'text-color': '#1A1612', 'text-halo-color': '#FBF9F5', 'text-halo-width': 1.15 },
  })
  addLayer(map, {
    id: 'measure-line', type: 'line', source: 'measure',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#EE9A3B', 'line-width': 2.6 },
  })
  addLayer(map, {
    id: 'measure-fill', type: 'fill', source: 'measure',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#EE9A3B', 'fill-opacity': 0.14 },
  })
  addLayer(map, {
    id: 'user-fill', type: 'fill', source: 'user',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#4FBDB6', 'fill-opacity': 0.2 },
  })
  addLayer(map, {
    id: 'user-line', type: 'line', source: 'user',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#4FBDB6', 'line-width': 2 },
  })
  addLayer(map, {
    id: 'user-pt', type: 'circle', source: 'user',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-color': '#4FBDB6', 'circle-radius': 5 },
  })
  addLayer(map, {
    id: 'probe-pt', type: 'circle', source: 'probe',
    paint: {
      'circle-radius': 7,
      'circle-color': '#EE9A3B',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#101D26',
      'circle-pitch-alignment': 'map',
    },
  })
  if (map.getLayer('sectors-3d')) {
    map.setLayoutProperty('sectors-3d', 'visibility', vis(three))
  }
  if (map.getLayer('dt-path')) {
    map.setLayoutProperty('dt-path', 'visibility', vis(!!recipe.dtLayer))
  }
  if (map.getLayer('dt-preview')) {
    map.setLayoutProperty('dt-preview', 'visibility', vis(!!recipe.dtLayer))
  }
  if (map.getLayer('sectors')) {
    map.setLayerZoomRange('sectors', 10, three ? 15 : 24)
  }
  if (map.getLayer('sectors-line')) {
    map.setLayerZoomRange('sectors-line', 10, three ? 15 : 24)
  }
  if (map.getLayer('city-3d')) {
    map.setLayoutProperty('city-3d', 'visibility', vis(three))
  }
}

let paintSeq = 0

export function dressAndPaint(map: any, geo: any, recipe: any, extras: any = {}) {
  const seq = ++paintSeq
  if (!map.isStyleLoaded()) {
    // 'load' fires once per map lifetime and has already fired by the time we get here,
    // so a once('load') registered post-boot never fires. 'idle' re-fires whenever the
    // map settles and 'style.load' covers setStyle, but neither is guaranteed if the map
    // is already idle while isStyleLoaded() is transiently false — hence the timer too.
    // seq drops superseded retries so stacked paints never re-apply stale geo.
    let done = false
    const retry = () => {
      if (done) return
      done = true
      map.off('idle', retry)
      map.off('style.load', retry)
      clearTimeout(timer)
      if (seq !== paintSeq) return
      dressAndPaint(map, geo, recipe, extras)
    }
    const timer = setTimeout(retry, 300)
    map.on('idle', retry)
    map.on('style.load', retry)
    return
  }
  try {
    if (recipe.view === '3d') enhance3d(map)
    ensureSources(map)
    ensureLayers(map, recipe)
    map.getSource('sites').setData(geo.siteFc)
    setSectorData(map, geo, recipe)
    map.getSource('holes')?.setData(recipe.holesLayer && extras.holes ? extras.holes : emptyFc())
    map.getSource('planned')?.setData(recipe.plannedLayer && geo.plannedFc ? geo.plannedFc : emptyFc())
    map.getSource('neighbors')?.setData(extras.neighborLines || emptyFc())
    map.getSource('candidate')?.setData(extras.candidateFc || emptyFc())
    map.getSource('dt-paths')?.setData(recipe.dtLayer && extras.dtPaths ? extras.dtPaths : emptyFc())
    map.getSource('dt-preview')?.setData(recipe.dtLayer && extras.dtPreview ? extras.dtPreview : emptyFc())
    setSelectedState(map, extras.selectedId || null)
    setNeighborState(map, extras.neighborIds)
    if (extras.tileUrls) {
      // Tiles are serving, so the packed-binary GPU path stays idle rather than
      // drawing the same samples twice.
      ensureTileLayers(map, extras.tileUrls)
      setTileLayerVisibility(map, recipe)
      paintHeavy(map, { gh: null, dt: null, recipe }).catch(() => { /* */ })
    } else {
      paintHeavy(map, { gh: extras.gh, dt: extras.dt, recipe }).catch((err) => {
        console.warn('deck.gl GPU layer failed', err)
      })
    }
  } catch (err) {
    console.error('dressAndPaint', err)
    window.__paintErr = String((err as any)?.message || err) + '\n' + ((err as any)?.stack || '')
  }
}

/**
 * Just the three sector sources. Lobe reach is a function of zoom (lobes.js
 * screenReachDeg), so geometry has to be rebuilt as the camera moves — but going
 * through paint() for that would re-render the facets drawer, chips, card, HUD and
 * URL hash on every frame, and run applyRecipe twice. This is the narrow path.
 */
/**
 * MVT measurement layers, served from PostGIS by geo-api.
 *
 * The alternative to gh.bin/dt.bin: instead of downloading every sample up front
 * and holding it in typed arrays, MapLibre fetches only the tiles in view and
 * evicts them again. Same RSRP ramp as the deck.gl path — COLOR_STOPS is the one
 * definition — so the two look identical and the legend stays honest either way.
 */
function rsrpRamp() {
  const stops = []
  for (const [val, c] of COLOR_STOPS) stops.push(val, `rgb(${c[0]},${c[1]},${c[2]})`)
  return ['interpolate', ['linear'], ['coalesce', ['get', 'rsrp'], -120], ...stops]
}

export function ensureTileLayers(map, urls) {
  if (!urls) return
  const add = (id, url, layerName, spec) => {
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'vector', tiles: [url], minzoom: 0, maxzoom: 16 })
    }
    if (!map.getLayer(id)) {
      try { map.addLayer({ id, source: id, 'source-layer': layerName, ...spec }) } catch { /* */ }
    }
  }
  const dot = (extra = {}) => ({
    type: 'circle',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 12, 2.4, 16, 4],
      'circle-color': rsrpRamp(),
      'circle-opacity': 0.85,
      ...extra,
    },
  })
  add('gh-mvt', urls.gh, 'gh', dot())
  add('dt-mvt', urls.dt, 'dt', dot({ 'circle-opacity': 0.95 }))
  add('route-mvt', urls.route, 'dt_route', {
    type: 'line',
    paint: { 'line-color': '#4FBDB6', 'line-width': 1.6, 'line-opacity': 0.9 },
  })
}

export function setTileLayerVisibility(map, recipe) {
  const set = (id, on) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }
  set('gh-mvt', !!recipe.ghLayer)
  set('dt-mvt', !!recipe.dtLayer)
  set('route-mvt', !!recipe.dtLayer)
}

export function setSectorData(map, geo, recipe) {
  if (!map.getSource('sectors')) return
  map.getSource('sectors').setData(recipe.sectorsLayer ? geo.sectorFc : emptyFc())
  map.getSource('spider').setData(recipe.spiderLayer ? geo.spiderFc : emptyFc())
  map.getSource('labels').setData(recipe.sectorsLayer ? geo.labelFc : emptyFc())
}
