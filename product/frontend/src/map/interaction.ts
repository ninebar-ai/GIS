import { emptyFc, ensureSources } from './sources'

export function setSelectedState(map, id) {
  if (map.__sel && map.getSource('sites')) {
    try { map.setFeatureState({ source: 'sites', id: map.__sel }, { selected: false }) } catch { /* */ }
  }
  map.__sel = id
  if (id && map.getSource('sites')) {
    try { map.setFeatureState({ source: 'sites', id }, { selected: true }) } catch { /* */ }
  }
}

export function setNeighborState(map, ids) {
  const idSet = ids instanceof Set ? ids : new Set(ids || [])
  const prev = map.__neighborIds || new Set()
  if (map.getSource('sectors')) {
    for (const id of prev) {
      if (!idSet.has(id)) {
        try { map.setFeatureState({ source: 'sectors', id }, { neighbor: false }) } catch { /* */ }
      }
    }
    for (const id of idSet) {
      try { map.setFeatureState({ source: 'sectors', id }, { neighbor: true }) } catch { /* */ }
    }
  }
  map.__neighborIds = idSet
}

export function bindHover(map) {
  map.on('mousemove', (e) => {
    const hit = queryHit(map, e)
    const next = hit ? { source: hit.source, id: hit.featureId } : null
    const prev = map.__hov
    if (prev && (!next || prev.id !== next.id || prev.source !== next.source)) {
      try { map.setFeatureState({ source: prev.source, id: prev.id }, { hover: false }) } catch { /* */ }
      map.__hov = null
    }
    if (next) {
      try { map.setFeatureState({ source: next.source, id: next.id }, { hover: true }) } catch { /* */ }
      map.__hov = next
      map.getCanvas().style.cursor = 'pointer'
    } else {
      map.getCanvas().style.cursor = map.__tool === 'drop' ? 'crosshair' : ''
    }
  })
}

export function setMeasureData(map, fc) {
  ensureSources(map)
  map.getSource('measure')?.setData(fc || emptyFc())
}

export function setUserData(map, fc) {
  ensureSources(map)
  map.getSource('user')?.setData(fc || emptyFc())
}

export function setProbeData(map, fc) {
  ensureSources(map)
  map.getSource('probe')?.setData(fc || emptyFc())
}

export function queryHit(map, e) {
  const layers = ['candidate-pin', 'candidate-ring', 'neighbors-line', 'sectors-3d', 'sectors', 'planned-ring', 'sites', 'sites-cluster'].filter((id) => map.getLayer(id))
  const hits = map.queryRenderedFeatures(e.point, { layers })
  const f = hits[0]
  if (!f) return null
  if (f.properties.cluster) {
    return {
      cluster: true,
      clusterId: f.properties.cluster_id,
      lngLat: f.geometry.coordinates,
      source: f.source,
    }
  }
  const featureId = f.id ?? f.properties.id
  return {
    // A connector line carries only the cell id — it must not masquerade as a site id.
    siteId: f.source === 'neighbors' ? null : (f.properties.site_id || f.properties.id),
    cellId: f.properties.id,
    source: f.source,
    featureId,
  }
}
export function visibleLayers(geo: any, recipe: any, userFc: any, extras: any = {}) {
  const layers = [{ name: 'sites', fc: geo.siteFc }]
  if (recipe.sectorsLayer) layers.push({ name: 'sectors', fc: geo.sectorFc })
  if (recipe.sectorsLayer && geo.labelFc?.features?.length) layers.push({ name: 'labels', fc: geo.labelFc })
  if (recipe.plannedLayer && geo.plannedFc?.features?.length) layers.push({ name: 'planned', fc: geo.plannedFc })
  if (extras.neighborLines?.features?.length) layers.push({ name: 'neighbors', fc: extras.neighborLines })
  if (extras.candidateFc?.features?.length) layers.push({ name: 'candidate', fc: extras.candidateFc })
  if (recipe.holesLayer && extras.holes?.features?.length) layers.push({ name: 'holes', fc: extras.holes })
  if (recipe.dtLayer && extras.dtPaths?.features?.length) layers.push({ name: 'dt-paths', fc: extras.dtPaths })
  if (recipe.dtLayer && extras.dtPreview?.features?.length) layers.push({ name: 'dt-preview', fc: extras.dtPreview })
  if (userFc?.features?.length) layers.push({ name: 'user', fc: userFc })
  return layers
}
