import { defaultRecipe } from '../filters'

export const LAYER_RAIL = [
  { key: 'sectorsLayer', glyph: '◗', tag: 'Sect', label: 'Sector lobes' },
  { key: 'spiderLayer', glyph: '⁂', tag: 'Cosi', label: 'Co-site spider (z≥14)' },
  { key: 'plannedLayer', glyph: '◎', tag: 'Plan', label: 'Planned sites' },
  { key: 'ghLayer', glyph: '▩', tag: 'GH', label: 'Groundhog RSRP' },
  { key: 'dtLayer', glyph: '⟿', tag: 'DT', label: 'Drive test' },
  { key: 'holesLayer', glyph: '⬡', tag: 'Hole', label: 'Coverage holes' },
  { key: 'ghContourLayer', glyph: '◍', tag: 'Cont', label: 'Groundhog contour' },
]

export const state: Record<string, any> = {
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
  voiceRec: null,
  voiceOut: false,
  cursor: null,
  frameMs: null,
  dtPaths: { type: 'FeatureCollection', features: [] },
  dtPreview: { type: 'FeatureCollection', features: [] },
  voiceGreeted: false,
  chatBusy: false,
  chatStatus: 'Ready',
  picker: null,
  heavy: null,
  holesFc: null,
  __z: null,
  messages: [],
  streamingId: null,
  railOpen: false,
  copilotOpen: false,
  focusMode: false,
  measure: { hidden: true, armed: false, text: '' },
  searchQuery: '',
  searchOpen: false,
  basemap: 'dark',
  loadError: null,
  ready: false,
  micOn: false,
  voiceSupported: true,
  hud: {
    zoom: 'Zoom —',
    cursor: 'Cursor —',
    selection: 'Selection 0',
    counts: '—',
    countsTitle: '',
    clock: 'Clock',
    crs: 'CRS EPSG:4326',
    frame: 'Frame — ms',
  },
}

export let askQueue: Promise<unknown> = Promise.resolve()
export function setAskQueue(p: Promise<unknown>) {
  askQueue = p
}

export let sectorFrame = 0
export function setSectorFrame(id: number) {
  sectorFrame = id
}

let rev = 0
const listeners = new Set<() => void>()

export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getRev() {
  return rev
}

export function notify() {
  rev += 1
  listeners.forEach((fn) => fn())
}

const hudListeners = new Set<() => void>()
export function subscribeHud(fn: () => void) {
  hudListeners.add(fn)
  return () => hudListeners.delete(fn)
}
export function notifyHud() {
  hudListeners.forEach((fn) => fn())
}
