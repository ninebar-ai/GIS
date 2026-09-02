export function emptyFc() {
  return { type: 'FeatureCollection', features: [] }
}

export function ensureSources(map) {
  if (!map.getSource('sites')) {
    map.addSource('sites', {
      type: 'geojson',
      data: emptyFc(),
      promoteId: 'id',
      cluster: true,
      clusterMaxZoom: 9,
      clusterRadius: 52,
    })
  }
  for (const id of ['sectors', 'spider', 'labels', 'holes', 'measure', 'user', 'probe', 'planned', 'neighbors', 'candidate', 'dt-paths', 'dt-preview']) {
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'geojson', data: emptyFc(), promoteId: 'id' })
    }
  }
}
