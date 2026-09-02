/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN?: string
  readonly VITE_MAP_TILES?: string
  readonly VITE_GEO_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __map?: unknown
  __state?: unknown
  __paintErr?: string
}

interface Element {
  dataset: DOMStringMap
}
