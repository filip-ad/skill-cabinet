# Contributing

Thanks for helping with Skill Cabinet. This fork is a read-only private view of governed skill snapshots. Keep the surface quiet and precise.

## Setup

Node 22.13+.

```bash
git clone git@github.com:filip-ad/skill-cabinet.git
cd skill-cabinet
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The API binds to localhost only (`127.0.0.1:3781` by default).

```bash
npm run build
npm start
```

## Layout

- `src/` Vite + React UI
- `server/` governed export loader, usage index, and HTTP API
- `bin/skill-cabinet.js` production entry
- `bin/skill-snapshot.js` filtered snapshot producer and installer
- `PRODUCT.md` users, tone, and design principles

## Pull requests

- One concern per PR.
- Do not add a browser mutation control, route, scanner, or raw log transfer.
- Do not bind the server to a public interface.
- Do not commit secrets, `.env` files, or `dist/`.
- `npm run build` should succeed.

Open an issue first for large scans, new skill roots, or destructive-path changes.

## License

Contributions are MIT. See [LICENSE](LICENSE).
