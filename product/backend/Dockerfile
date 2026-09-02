# Two-stage: build the frontend with node, then serve it from the python backend.
# Build from the product root:
#   cd product
#   docker build -f backend/Dockerfile -t nineone-gis .

FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY backend/pyproject.toml ./backend/pyproject.toml
RUN pip install --no-cache-dir "openai>=1.40"

COPY backend/ ./backend/
COPY db/published/ ./db/published/
COPY --from=frontend /build/dist ./frontend/dist

ENV HOST=0.0.0.0 PORT=8765
EXPOSE 8765
# GEO_API_URL points at the geo-api service; unset it to run file-only.
CMD ["python", "backend/serve.py"]
