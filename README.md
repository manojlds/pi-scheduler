# pi-scheduler

Simple scheduled loop/reminder extension for [pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent).

## Features

- `/loop` recurring prompts (default every 10m)
- `/remind` one-time reminders
- `/schedule` management (`list`, `delete`, `clear`)
- Session-scoped runtime scheduler (in-memory)
- Idle-only dispatch (tasks fire between turns)
- Max 50 tasks
- Recurring tasks auto-expire after 3 days

## Install

```bash
pi install npm:pi-scheduler
```

Then restart pi or run:

```bash
/reload
```

## Usage

### Recurring loop

```text
/loop 5m check if CI is green
/loop check deployment logs every 2h
/loop check build status
```

> If no interval is provided, `/loop` defaults to every 10 minutes.

### One-time reminder

```text
/remind in 45m check integration test results
/remind 2h follow up on release PR
```

### Manage tasks

```text
/schedule list
/schedule delete <id>
/schedule clear
/unschedule <id>
```

## Notes

- This is a **simple session-scoped scheduler**.
- Tasks run only while pi is open.
- Tasks are not persisted across process restarts.
- Intervals are rounded up to minute granularity.

## Local development

```bash
npm install
npm run typecheck
```

Load directly:

```bash
pi -e ./index.ts
```

## Publish

### One-off from local machine

```bash
npm publish --access public
```

### Via GitHub Actions (recommended)

A workflow is included at `.github/workflows/publish.yml`.

1. Add repository secret: `NPM_TOKEN`
   - Create from npm: **npmjs.com → Access Tokens → Automation**
2. Commit + push changes
3. Bump version in `package.json`
4. Create and push a tag matching that version:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow will:
- run `npm ci`
- run `npm run typecheck`
- verify tag version matches `package.json`
- publish to npm with provenance

If you want scoped publishing instead:

```bash
# rename package to @your-scope/pi-scheduler in package.json
npm publish --access public
```
