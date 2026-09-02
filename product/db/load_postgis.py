"""Load the published artifacts into PostGIS, without needing the raw RMI dumps.

`ingest.py --postgis` does this as part of a full re-ingest. This does it from
inventory.json / gh.bin / dt.bin / dt_paths.geojson that are already on disk, which
is what you want when the database is new but the publish is current.

    POSTGRES_URL=postgresql+psycopg://nineone:nineone@localhost:5432/nineone \
        python load_postgis.py

Writes through repositories/geo/loader.py — the Context Layer is the only door to
the store (PLATFORM.md golden rule 4).
"""
from __future__ import annotations

import json
import os
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent            # product/db -> product -> GIS -> parent repo
PUBLISHED = HERE / "published"
for extra in (str(ROOT), str(ROOT / "context-layer")):
    if extra not in sys.path:
        sys.path.insert(0, extra)

ORG = os.environ.get("GEO_ORG_ID", "demo")
WS = os.environ.get("GEO_WORKSPACE_ID", "tokyo")


def unwrap(field):
    if isinstance(field, dict) and "value" in field:
        return field["value"]
    return field


def read_packed(path: Path):
    """f32le lng,lat,rsrp triplets — the same format heavy.js decodes."""
    if not path.is_file():
        return []
    raw = path.read_bytes()
    n = len(raw) // 12
    vals = struct.unpack(f"<{n * 3}f", raw[: n * 12])
    return [(vals[i * 3], vals[i * 3 + 1], vals[i * 3 + 2]) for i in range(n)]


def main() -> None:
    from repositories.geo.loader import load_cells, load_routes, load_samples

    inv = json.loads((PUBLISHED / "inventory.json").read_text(encoding="utf-8"))
    cells = [{
        "site_id": c.get("site_id"),
        "cell_id": c.get("cell_id"),
        "tech": unwrap(c.get("tech")),
        "lat": unwrap(c.get("lat")),
        "lng": unwrap(c.get("lng")),
        "azimuth": unwrap(c.get("azimuth")),
        "hpbw": unwrap(c.get("hpbw")),
        "mech_tilt": unwrap(c.get("mech_tilt")),
        "elec_tilt": unwrap(c.get("elec_tilt")),
        "height_m": unwrap(c.get("height_m")),
        "pci": unwrap(c.get("pci")),
        "band": unwrap(c.get("band")),
        "area": unwrap(c.get("site_type")),
    } for c in inv.get("cells", [])]

    gh = read_packed(PUBLISHED / (inv.get("groundhog", {}).get("file") or "gh.bin"))
    dt = read_packed(PUBLISHED / (inv.get("drive_test", {}).get("file") or "dt.bin"))
    routes_path = PUBLISHED / (inv.get("drive_test_paths", {}).get("file") or "dt_paths.geojson")
    routes = json.loads(routes_path.read_text(encoding="utf-8")).get("features", []) if routes_path.is_file() else []

    report = {
        "tenant": f"{ORG}/{WS}",
        "cells": load_cells(cells, org_id=ORG, workspace_id=WS, geo_source="ns-qaw-published"),
        "gh": load_samples(({"sample_id": i, "lng": r[0], "lat": r[1], "rsrp": r[2]} for i, r in enumerate(gh)),
                           kind="gh", org_id=ORG, workspace_id=WS, geo_source="gh.bin"),
        "dt": load_samples(({"sample_id": i, "lng": r[0], "lat": r[1], "rsrp": r[2]} for i, r in enumerate(dt)),
                           kind="dt", org_id=ORG, workspace_id=WS, geo_source="dt.bin"),
        "routes": load_routes(routes, org_id=ORG, workspace_id=WS, geo_source="dt_paths"),
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
