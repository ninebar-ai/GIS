import { useEffect } from 'react'
import { FilterDrawerHost } from './ui/FilterDrawer'
import { bootLegacyApp } from './legacyApp'

export function App() {
  useEffect(() => {
    void bootLegacyApp()
  }, [])

  return (
    <>
      <div className="stage" id="stage">
        <div id="map"></div>

        <header className="dock top glass" id="dock-top">
          <div className="dock-row hud-bar">
            <div className="brand">
              <div className="u-mono">NineOne · Geo</div>
              <strong>Tokyo RAN Workbench</strong>
            </div>
            <label className="search">
              <input id="search" type="search" autoComplete="off" placeholder="Search sites, cells, PCI…" />
              <div className="typeahead" id="typeahead" hidden></div>
            </label>
            <div className="toolbar" id="tools" role="toolbar" aria-label="Spatial tools">
              <button type="button" className="tool on" data-tool="pan" title="Pan (P)">Pan</button>
              <div className="tool-group measure-group">
                <button type="button" className="tool" data-tool="ruler" title="Ruler (R)">Ruler</button>
                <button type="button" className="tool" data-tool="radius" title="Radius (A)">Radius</button>
              </div>
              <button type="button" className="tool" data-tool="drop" title="New site (N)">New site</button>
              <div className="seg" role="group" aria-label="View">
                <button type="button" className="tool on" data-view="2d" title="2D">2D</button>
                <button type="button" className="tool" data-view="3d" title="3D">3D</button>
              </div>
              <select id="basemap" title="Basemap">
                <option value="dark">Plan · dark</option>
                <option value="paper">Plan · paper</option>
                <option value="satellite">Satellite</option>
                <option value="terrain">Terrain</option>
                <option value="liberty">Street</option>
                <option value="positron">Soft</option>
              </select>
            </div>
            <button type="button" className="dock-btn" id="btn-rail" title="Layer panel (F)">Layers</button>
            <details className="more">
              <summary title="More">⋯</summary>
              <div className="more-menu glass">
                <button type="button" id="btn-import">Import overlay</button>
                <button type="button" id="btn-geojson">Download GeoJSON</button>
                <button type="button" id="btn-kml">Download KML</button>
                <button type="button" id="btn-shot">Snapshot PNG</button>
              </div>
            </details>
            <button type="button" className="dock-btn icon-only" id="btn-focus" aria-pressed="false" title={"Focus mode — hide panels (\\)"}>⛶</button>
            <input id="file-import" type="file" accept=".geojson,.json,.kml" hidden />
          </div>
        </header>

        <button type="button" className="focus-exit" id="focus-exit" title={"Leave focus mode (\\ or Esc)"}>⛶</button>

        <div className="overlay-top" id="overlay-top">
          <div className="context-strip" id="context-strip" hidden>
            <div className="u-mono" id="context-label">Context</div>
            <div className="context-actions" id="context-actions"></div>
          </div>
          <div className="chips" id="chips"></div>
        </div>

        <nav className="layer-rail glass" id="layer-rail" aria-label="Layers"></nav>

        <div className="legend glass" id="legend" hidden aria-label="RSRP scale"></div>

        <div className="picker glass" id="picker" hidden role="status"></div>

        <aside className="drawer glass" id="rail" aria-hidden="true">
          <header>
            <div>
              <div className="u-mono">Layers + filters</div>
            </div>
            <button type="button" className="icon-btn" id="rail-x">×</button>
          </header>
          <div className="facets" id="facets">
            <FilterDrawerHost />
          </div>
        </aside>

        <aside className="glass" id="copilot" role="dialog" aria-label="Copilot chat" aria-modal="false" aria-hidden="true">
          <header className="copilot-head">
            <div>
              <div className="u-mono">Copilot chat</div>
              <h2>Ask Copilot</h2>
            </div>
            <div className="copilot-head-actions">
              <button type="button" className="icon-btn action-btn" id="copilot-clear" title="Clear visible transcript">Clear</button>
              <button type="button" className="icon-btn action-btn" id="copilot-reset-memory" title="Reset server memory">Reset</button>
              <button type="button" className="icon-btn" id="copilot-x">×</button>
            </div>
          </header>
          <div className="copilot-subhead">
            <span className="u-mono" id="copilot-scope">Scope · overview</span>
            <span className="u-mono" id="copilot-status">Ready</span>
          </div>
          <div className="starters" id="starters"></div>
          <div className="log" id="log" aria-live="polite"></div>
          <form className="composer" id="composer">
            <button type="button" className="mic" id="btn-mic" title="Voice command">Voice</button>
            <input id="ask" type="text" autoComplete="off" placeholder="Ask anything about sites, alarms, drive test, or neighbours..." />
            <button type="submit">Run</button>
          </form>
        </aside>

        <article className="card glass" id="card" hidden></article>
        <div className="measure glass" id="measure" hidden></div>

        <footer className="dock bottom" id="dock-bottom" title="CRS EPSG:4326">
          <span className="pill-stat" id="hud-zoom">Zoom —</span>
          <span className="pill-stat" id="hud-cursor">Cursor —</span>
          <span className="pill-stat" id="hud-selection">Selection 0</span>
          <span className="pill-stat" id="counts">—</span>
          <span className="pill-stat u-mono" id="clock-label">Clock</span>
          <span className="pill-stat diag" id="hud-crs">CRS EPSG:4326</span>
          <span className="pill-stat diag" id="hud-latency">Frame — ms</span>
        </footer>
      </div>

      <button type="button" id="copilot-fab" aria-controls="copilot" aria-label="Open Copilot chat" aria-expanded="false" title="Copilot chat (C)">
        <span className="fab-icon" aria-hidden="true">💬</span>
      </button>
    </>
  )
}

export default App
