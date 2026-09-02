# Frontend

Map workbench UI built with React + TypeScript + Vite, with MapLibre + deck.gl rendering modules.

## Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Production build: `npm run build`
- Preview build: `npm run preview`
- Tests: `npm run test`

## Key Files

- `index.html` - React mount shell.
- `src/main.tsx` - React entrypoint and legacy bootstrap hook.
- `src/App.tsx` - static UI shell rendered by React.
- `src/legacyApp.js` - existing app orchestration, UI wiring, Copilot intent application.
- `src/map.js` - map style/layers/camera behavior.
- `src/data.js` - geo-api and file fallback data gateway.
- `src/chat.js` - deterministic parser + streaming fallback client.
