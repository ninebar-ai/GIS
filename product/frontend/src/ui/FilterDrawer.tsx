import { v } from '../lobes'
import { EMPTY_REASON, nPts, toggleRecipePill } from '../filters'
import { useWorkbench } from '../workbench/useWorkbench'
import { applyRecipeChange } from '../legacyApp'

function Pill({ recipe, facetKey, val, n, onToggle }: { recipe: any; facetKey: string; val: string; n: number; onToggle: (key: string, val: string) => void }) {
  const on = Array.isArray(recipe[facetKey]) ? recipe[facetKey].includes(val) : recipe[facetKey] === val
  const zero = n === 0
  const reason = EMPTY_REASON[val]
  return (
    <button
      type="button"
      className={`pill${on ? ' on' : ''}${zero ? ' zero' : ''}`}
      title={reason && zero ? reason : val}
      onClick={() => onToggle(facetKey, val)}
    >
      {val}<small> {n}</small>
    </button>
  )
}

function PillRow({ title, facetKey, values, getN, recipe, onToggle }: { title: string; facetKey: string; values: string[]; getN: (val: string) => number; recipe: any; onToggle: (key: string, val: string) => void }) {
  const live = values.filter((val) => getN(val) > 0 || !EMPTY_REASON[val])
  if (!live.length) return null
  return (
    <div className="facet">
      <h3>{title}</h3>
      <div className="facet-row">
        {live.map((val) => (
          <Pill key={val} recipe={recipe} facetKey={facetKey} val={val} n={getN(val)} onToggle={onToggle} />
        ))}
      </div>
    </div>
  )
}

export function FilterDrawer({ inv, recipe, onChange }: { inv: any; recipe: any; onChange: (next: any) => void }) {
  if (!inv?.enums) return null
  const enums = inv.enums
  const vocN = nPts(inv.voc)
  const dated = inv.sites.filter((s) => v(s.on_air_date)).length
  const techN = (val: string) => new Set(inv.cells.filter((c) => v(c.tech) === val).map((c) => c.site_id)).size
  const typeN = (val: string) => inv.sites.filter((s) => v(s.site_type) === val).length
  const morphN = (val: string) => inv.sites.filter((s) => v(s.morphology) === val).length
  const emptyTech = (enums.tech || []).filter((val) => techN(val) === 0)
  const emptyType = (enums.site_type || []).filter((val) => typeN(val) === 0)
  const liveTech = (enums.tech || []).filter((val) => techN(val) > 0)
  const liveType = (enums.site_type || []).filter((val) => typeN(val) > 0)
  const emptyBits = []
  if (emptyTech.length) emptyBits.push(emptyTech.join(', ') + ' — 4G only')
  if (emptyType.length) emptyBits.push(emptyType.join(', ') + ' — MACRO only')
  if (vocN === 0) emptyBits.push(EMPTY_REASON.VOC)
  const carriers = [...new Set(inv.cells.map((c) => String(v(c.carrier) || '')).filter(Boolean))].sort() as string[]
  const onToggle = (key: string, val: string) => onChange(toggleRecipePill(recipe, key, val))
  const setLayer = (key: string, on: boolean) => onChange({ ...recipe, [key]: on })

  return (
    <>
      <section className="facet-group">
        <h2>Layer Stack</h2>
        <div className="facet">
          <h3>Layer stack</h3>
          <label className="toggle"><input type="checkbox" checked={!!recipe.plannedLayer} onChange={(e) => setLayer('plannedLayer', e.target.checked)} /> Planned sites</label>
          <label className="toggle"><input type="checkbox" checked={!!recipe.sectorsLayer} onChange={(e) => setLayer('sectorsLayer', e.target.checked)} /> Sector lobes</label>
          <label className="toggle"><input type="checkbox" checked={!!recipe.ghLayer} onChange={(e) => setLayer('ghLayer', e.target.checked)} /> Groundhog ({nPts(inv.groundhog).toLocaleString()})</label>
          <label className="toggle"><input type="checkbox" checked={!!recipe.dtLayer} onChange={(e) => setLayer('dtLayer', e.target.checked)} /> Drive test routes ({Number(inv.drive_test_paths?.n_routes || 0).toLocaleString()})</label>
        </div>
      </section>
      <section className="facet-group">
        <h2>Layer Filters</h2>
        <PillRow title="Status" facetKey="status" values={enums.status || []} getN={(val) => inv.sites.filter((s) => v(s.status) === val).length} recipe={recipe} onToggle={onToggle} />
        <PillRow title="Band" facetKey="band" values={enums.band?.length ? enums.band : ['B3']} getN={(val) => new Set(inv.cells.filter((c) => v(c.band) === val).map((c) => c.site_id)).size} recipe={recipe} onToggle={onToggle} />
        {carriers.length > 0 && (
          <PillRow title="Carrier" facetKey="carrier" values={carriers} getN={(val) => new Set(inv.cells.filter((c) => String(v(c.carrier)) === val).map((c) => c.site_id)).size} recipe={recipe} onToggle={onToggle} />
        )}
        <div className="facet">
          <h3>Fault</h3>
          <div className="facet-row">
            <button type="button" className={`pill${recipe.inAlarm === true ? ' on' : ''}`} onClick={() => onToggle('inAlarm', 'true')}>
              in alarm<small> {inv.sites.filter((s) => s.in_alarm).length}</small>
            </button>
            <button type="button" className={`pill${recipe.serviceAffecting === true ? ' on' : ''}`} onClick={() => onToggle('sa', 'true')}>
              service affecting
            </button>
          </div>
        </div>
      </section>
      <section className="facet-group">
        <h2>Data Sources</h2>
        <div className="facet">
          <h3>Data sources</h3>
          <p className="hint">Sites {inv.sites.length} · Cells {inv.cells.length} · VOC {vocN.toLocaleString()}</p>
        </div>
        <div className="facet">
          <h3>On-air date</h3>
          <div className="range">
            <label>from <input type="date" value={recipe.onAirFrom || ''} onChange={(e) => onChange({ ...recipe, onAirFrom: e.target.value })} /></label>
            <label>to <input type="date" value={recipe.onAirTo || ''} onChange={(e) => onChange({ ...recipe, onAirTo: e.target.value })} /></label>
          </div>
          <p className="hint">{dated} / {inv.sites.length} sites with dates in current ingest.</p>
        </div>
      </section>
      <section className="facet-group">
        <h2>Advanced</h2>
        <details className="more-filters">
          <summary>Advanced filters</summary>
          {liveTech.length > 0 && (
            <div className="facet">
              <h3>Technology</h3>
              <div className="facet-row">
                {liveTech.map((val) => <Pill key={val} recipe={recipe} facetKey="tech" val={val} n={techN(val)} onToggle={onToggle} />)}
              </div>
            </div>
          )}
          {liveType.length > 0 && (
            <div className="facet">
              <h3>Site type</h3>
              <div className="facet-row">
                {liveType.map((val) => <Pill key={val} recipe={recipe} facetKey="siteType" val={val} n={typeN(val)} onToggle={onToggle} />)}
              </div>
            </div>
          )}
          <PillRow title="Morphology" facetKey="morphology" values={enums.morphology || []} getN={morphN} recipe={recipe} onToggle={onToggle} />
          <div className="facet">
            <h3>More layers</h3>
            <label className="toggle"><input type="checkbox" checked={!!recipe.spiderLayer} onChange={(e) => setLayer('spiderLayer', e.target.checked)} /> Co-site spider · z≥14</label>
            <label className="toggle"><input type="checkbox" checked={!!recipe.holesLayer} onChange={(e) => setLayer('holesLayer', e.target.checked)} /> Coverage holes · GH RSRP ≤ −105</label>
            <label className="toggle"><input type="checkbox" checked={!!recipe.ghContourLayer} onChange={(e) => setLayer('ghContourLayer', e.target.checked)} /> Groundhog contour</label>
            <label className="toggle"><input type="checkbox" checked={!!recipe.vocLayer} onChange={(e) => setLayer('vocLayer', e.target.checked)} /> VOC · {vocN} geocoded</label>
          </div>
          <div className="facet">
            <h3>PCI</h3>
            <input className="pci-in" value={recipe.pci || ''} onChange={(e) => onChange({ ...recipe, pci: e.target.value.trim() })} />
          </div>
          <div className="facet">
            <h3>Height / tilt</h3>
            <div className="range">
              <label>h min <input type="number" value={recipe.height[0] ?? ''} onChange={(e) => onChange({ ...recipe, height: [e.target.value === '' ? null : Number(e.target.value), recipe.height[1]] })} /></label>
              <label>h max <input type="number" value={recipe.height[1] ?? ''} onChange={(e) => onChange({ ...recipe, height: [recipe.height[0], e.target.value === '' ? null : Number(e.target.value)] })} /></label>
              <label>tilt min <input type="number" value={recipe.mechTilt[0] ?? ''} onChange={(e) => onChange({ ...recipe, mechTilt: [e.target.value === '' ? null : Number(e.target.value), recipe.mechTilt[1]] })} /></label>
              <label>tilt max <input type="number" value={recipe.mechTilt[1] ?? ''} onChange={(e) => onChange({ ...recipe, mechTilt: [recipe.mechTilt[0], e.target.value === '' ? null : Number(e.target.value)] })} /></label>
            </div>
          </div>
          {emptyBits.length > 0 && <p className="hint">{emptyBits.join(' · ')}</p>}
        </details>
      </section>
    </>
  )
}

/** Subscribe here only — never from App — so paint() cannot wipe imperative chrome. */
export function FilterDrawerHost() {
  const { state } = useWorkbench()
  if (!state.inv) return null
  return <FilterDrawer inv={state.inv} recipe={state.recipe} onChange={applyRecipeChange} />
}
