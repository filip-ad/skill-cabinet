# Skill Cabinet

A local catalog for agent skills installed on this machine. It scans user-level drawers such as `.agents`, `.claude`, `.codex`, `.cursor` (including plugins), and other `~/.* /skills` folders, lets you read each skill and its frontmatter, and can delete skill folders from disk.

## Run

```bash
npx skill-cabinet
```

That starts a local server on `127.0.0.1` (port `3781` by default) and opens it in your browser. Bind only happens on localhost.

```bash
# keep the current tab
SKILL_CABINET_NO_OPEN=1 npx skill-cabinet

# pick a port
PORT=4000 npx skill-cabinet
```

Requires Node 20+.

## What it can do

- Filter by drawer and search name, description, path, or frontmatter
- Read the skill body (rendered or source), YAML frontmatter, and extra files in the folder
- Delete one skill or several at once

**Delete** removes the skill directory from disk. There is no undo. Builtin Cursor skills and plugin-cache copies may come back the next time that tool updates.

Keys: `j`/`k` move, `/` find, `x` mark, `d` delete.

## Develop

```bash
git clone git@github.com:subsy/skill-cabinet.git
cd skill-cabinet
npm install
npm run dev
```

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173). Production mode after a build:

```bash
npm run build
npm start
```

## License

MIT
