export type ProvenanceField<T = unknown> = T | { value: T; source?: string; measuredAt?: string | null }

export type SiteRecord = {
  site_id: string
  lng?: ProvenanceField<number | null>
  lat?: ProvenanceField<number | null>
  status?: ProvenanceField<string>
  site_type?: ProvenanceField<string>
  morphology?: ProvenanceField<string>
  sarf_id?: ProvenanceField<string>
  enb_name?: ProvenanceField<string>
  ems_server?: ProvenanceField<string>
  on_air_date?: ProvenanceField<string>
  in_alarm?: boolean
  alarm_summary?: { service_affecting?: boolean }
  [key: string]: unknown
}

export type CellRecord = {
  cell_id: string
  site_id: string
  lng?: ProvenanceField<number | null>
  lat?: ProvenanceField<number | null>
  azimuth?: ProvenanceField<number | null>
  hpbw?: ProvenanceField<number | null>
  band?: ProvenanceField<string>
  pci?: ProvenanceField<number | string>
  tech?: ProvenanceField<string>
  status?: ProvenanceField<string>
  height_m?: ProvenanceField<number | null>
  mech_tilt?: ProvenanceField<number | null>
  elec_tilt?: ProvenanceField<number | null>
  cell_name?: ProvenanceField<string>
  ecgi?: ProvenanceField<string>
  sarf_id?: ProvenanceField<string>
  carrier?: ProvenanceField<string | number>
  has_cm_azimuth?: boolean
  in_alarm?: boolean
  [key: string]: unknown
}

export type Inventory = {
  sites: SiteRecord[]
  cells: CellRecord[]
  clock?: { t?: string; source?: string }
  enums?: Record<string, string[]>
  groundhog?: { file?: string; n?: number }
  drive_test?: { file?: string; n?: number }
  drive_test_paths?: { file?: string; n_routes?: number }
  voc?: { n?: number } | unknown[]
  [key: string]: unknown
}

export type Recipe = {
  tech: string[]
  band: string[]
  siteType: string[]
  status: string[]
  morphology: string[]
  carrier: string[]
  inAlarm: boolean | null
  serviceAffecting: boolean | null
  view: '2d' | '3d'
  sectorsLayer: boolean
  spiderLayer: boolean
  ghLayer: boolean
  dtLayer: boolean
  holesLayer: boolean
  ghContourLayer: boolean
  vocLayer: boolean
  plannedLayer: boolean
  pci: string
  onAirFrom: string
  onAirTo: string
  height: [number | null, number | null]
  mechTilt: [number | null, number | null]
  hasCmAzimuth: boolean
  azimuthRange: [number, number] | null
  identity: string
}

export type GeoJSONGeometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'Polygon'; coordinates: number[][][] }

export type GeoJSONFeature = {
  type: 'Feature'
  id?: string | number
  properties: Record<string, unknown>
  geometry: GeoJSONGeometry
}

export type FeatureCollection = {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

export type PackedCloud = {
  n: number
  positions: Float32Array
  colors: Uint8Array
  weights: Float32Array
  rsrp: Float32Array
  bbox: [number, number, number, number] | null
}

export type NeighborSession = {
  kind: 'site' | 'pin'
  targetId?: string
  lat?: number
  lng?: number
  auto: Set<string>
  added: Set<string>
  removed: Set<string>
  events: Array<{ t: string; action: string; cellId: string | null }>
}

export type CopilotIntent = {
  type: string
  recipe?: Partial<Recipe>
  select?: string | null
  siteId?: string | null
  fly?: string | null
  section?: string | null
  reset?: boolean
  narrate?: string
  _route?: string
  [key: string]: unknown
}
