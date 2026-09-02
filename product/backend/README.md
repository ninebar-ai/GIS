# Backend

Python HTTP host for frontend assets and Copilot/network proxies.

## Responsibilities

- Serves built frontend from `product/frontend/dist`.
- Serves published data from `product/db/published`.
- Exposes `/api/chat`, `/api/chat/stream`, `/api/chat/memory`, `/api/chat/reset`.
- Proxies `/geo/*` to upstream geo-api with tenant headers.

## Run

- `python serve.py` (from `product/backend`)
- or `python product/backend/serve.py` (from repo root)

## Configuration

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEO_API_URL`, `GEO_ORG_ID`, `GEO_WORKSPACE_ID`
- `PORT`, `HOST`
