import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { detachDeck } from '../heavy'
import { bindHover } from './interaction'

const TERRAIN = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 15,
}

const ESRI = {
  tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  tileSize: 256,
  attribution: 'Esri',
  maxzoom: 19,
}

/** Basemaps that render a dark ground. The vector palette flips to match. */
export const DARK_BASEMAPS = new Set(['dark', 'satellite', 'terrain'])

/**
 * Dark plan view — the default.
 *
 * Same muted Esri imagery STACK.md locks in, but inverted to an ink ground so the
 * status colours and the RSRP ramp carry the signal instead of competing with a
 * bright basemap (P4, "colour is a scarce resource"). `planStyle()` below is the
 * light original, still reachable as the "Paper" basemap.
 */
export function darkStyle() {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      esri: { type: 'raster', tiles: ESRI.tiles, tileSize: 256, attribution: ESRI.attribution, maxzoom: 19 },
    },
    layers: [
      { id: 'ink', type: 'background', paint: { 'background-color': '#0E1216' } },
      {
        id: 'sat', type: 'raster', source: 'esri',
        paint: {
          'raster-saturation': -0.92,
          'raster-opacity': 0.3,
          'raster-brightness-min': 0.06,
          'raster-brightness-max': 0.5,
          'raster-contrast': 0.12,
        },
      },
    ],
  }
}

export function planStyle() {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      esri: { type: 'raster', tiles: ESRI.tiles, tileSize: 256, attribution: ESRI.attribution, maxzoom: 19 },
    },
    layers: [
      { id: 'paper', type: 'background', paint: { 'background-color': '#F0EEE8' } },
      {
        id: 'sat', type: 'raster', source: 'esri',
        paint: {
          'raster-saturation': -0.7,
          'raster-opacity': 0.42,
          'raster-brightness-min': 0.35,
          'raster-brightness-max': 1,
          'raster-contrast': -0.18,
        },
      },
    ],
  }
}

export function cinematicStyle() {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      esri: { type: 'raster', tiles: ESRI.tiles, tileSize: 256, attribution: ESRI.attribution, maxzoom: 19 },
      terrain: TERRAIN,
    },
    layers: [
      { id: 'sat', type: 'raster', source: 'esri', paint: { 'raster-saturation': -0.12, 'raster-contrast': 0.08 } },
      {
        id: 'hillshade', type: 'hillshade', source: 'terrain',
        paint: {
          'hillshade-exaggeration': 0.42,
          'hillshade-shadow-color': '#05080c',
          'hillshade-highlight-color': '#fff3d6',
          'hillshade-illumination-direction': 226,
        },
      },
    ],
  }
}

export function createMap(container: HTMLElement | string, { view = '2d', onLoad }: { view?: string; onLoad?: (map?: any) => void } = {}) {
  const three = view === '3d'
  const map: any = new maplibregl.Map({
    container,
    style: (three ? cinematicStyle() : darkStyle()) as any,
    center: [139.7034, 35.661],
    zoom: three ? 14.05 : 13.4,
    pitch: three ? 64 : 0,
    bearing: three ? -28 : 0,
    maxPitch: 85,
    attributionControl: false,
    preserveDrawingBuffer: true,
    hash: false,
  } as any)
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: true }), 'top-right')
  map.addControl(new maplibregl.FullscreenControl(), 'top-right')
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
  map.__view = view
  map.__dark = true // darkStyle() is the 2D default
  bindHover(map)
  const fire = () => onLoad?.(map)
  map.once('load', fire)
  map.once('idle', fire)
  map.on('style.load', () => {
    if (map.__view === '3d') enhance3d(map)
  })
  return map
}

export function enhance3d(map) {
  try {
    if (!map.getSource('terrain')) map.addSource('terrain', TERRAIN)
    map.setTerrain({ source: 'terrain', exaggeration: 1.55 })
  } catch { /* */ }
  try {
    map.setSky({
      'sky-color': '#120e0a',
      'horizon-color': '#3a2416',
      'fog-color': '#14110c',
      'sky-horizon-blend': 0.55,
      'horizon-fog-blend': 0.72,
      'fog-ground-blend': 0.35,
    })
  } catch { /* */ }
  try {
    map.setLight({ anchor: 'viewport', color: '#fff6e8', intensity: 0.55, position: [1.2, 210, 28] })
  } catch { /* */ }
  addCity(map)
}

function addCity(map) {
  try {
    if (!map.getSource('openmaptiles')) {
      map.addSource('openmaptiles', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' })
    }
  } catch { return }
  if (map.getLayer('city-3d')) return
  try {
    map.addLayer({
      id: 'city-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': '#1a1712',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 16],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.72,
        'fill-extrusion-vertical-gradient': true,
      },
    })
  } catch { /* style already has buildings */ }
}

export function applyView(map, view) {
  map.__view = view
  map.stop()
  if (view === '3d') {
    enhance3d(map)
    map.easeTo({ pitch: 64, bearing: -28, duration: 700 })
  } else {
    try { map.setTerrain(null) } catch { /* */ }
    map.easeTo({ pitch: 0, bearing: 0, duration: 500 })
  }
  const three = view === '3d'
  const vis = (on: boolean) => (on ? 'visible' : 'none')
  if (map.getLayer('sectors-3d')) map.setLayoutProperty('sectors-3d', 'visibility', vis(three))
  if (map.getLayer('sectors')) map.setLayerZoomRange('sectors', 10, three ? 15 : 24)
  if (map.getLayer('sectors-line')) map.setLayerZoomRange('sectors-line', 10, three ? 15 : 24)
  if (map.getLayer('city-3d')) map.setLayoutProperty('city-3d', 'visibility', vis(three))
}

export async function setBasemap(map, name, after) {
  detachDeck(map)
  map.__dark = DARK_BASEMAPS.has(name)
  const view = map.__view || '2d'
  const target =
    name === 'satellite' ? cinematicStyle()
      : name === 'terrain' ? cinematicStyle()
        : name === 'dark' ? darkStyle()
          : name === 'paper' ? planStyle()
            : name === 'liberty' ? 'https://tiles.openfreemap.org/styles/liberty'
              : 'https://tiles.openfreemap.org/styles/positron'
  let done = false
  let timer = null
  const finish = () => {
    if (done || !map.isStyleLoaded()) return
    done = true
    map.off('style.load', finish)
    map.off('idle', finish)
    if (timer != null) clearTimeout(timer)
    if (view === '3d' || name === 'terrain') enhance3d(map)
    if (name === 'terrain' && view !== '3d') {
      try { map.setTerrain({ source: 'terrain', exaggeration: 1.15 }) } catch { /* */ }
    }
    after?.()
  }
  map.on('style.load', finish)
  map.on('idle', finish)
  map.setStyle(target)
  timer = setTimeout(finish, 1200)
  // No synchronous finish() call here: setStyle() kicks off an internal
  // diff-and-patch transition for remote styles that isn't done just because
  // isStyleLoaded() happens to still read true this tick. Firing finish() early
  // races that transition — paint() adds our sources, then the diff step strips
  // out anything not present in the target style's own JSON, since it never knew
  // about app-added extras like 'sites'/'sectors'. That's why liberty and
  // positron (the two remote-URL basemaps) permanently lost every site/sector
  // after a switch. The style.load/idle listeners plus the timeout fallback
  // above are enough on their own.
}
