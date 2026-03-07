# pi-scheduler

Simple scheduled loop/reminder extension for [pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent).

`pi-scheduler` adds lightweight in-session scheduling so you can re-run prompts on an interval or set one-time reminders while you work.

---

## Features

- Recurring loops via `/loop`
- One-time reminders via `/remind`
- Task management via `/schedule` and `/unschedule`
- Idle-only dispatch (tasks fire between turns)
- Session-scoped runtime (no background daemon)
- Up to **50 active tasks**
- Recurring tasks auto-expire after **3 days**
- Minute-granularity scheduling with automatic rounding

---

## Install

### From npm

```bash
pi install npm:pi-scheduler
```

Restart pi or run:

```text
/reload
```

### Local package (for development)

From your project root, add `.pi/settings.json`:

```json
{
  "packages": [".."]
}
```

This points pi to the local package directory for live testing.

---

## Quick start

```text
/loop 5m check if CI is green
/remind in 45m check integration tests
/schedule list
```

---

## Command reference

### `/loop`

Schedule a recurring prompt.

### Supported forms

```text
/loop 30m check the build
/loop 2 hours check deployment
/loop check deployment every 2h
/loop check build status
```

If no interval is given, default is **every 10m**.

---

### `/remind`

Schedule a one-time reminder.

### Supported forms

```text
/remind in 45m check test results
/remind 2h follow up on release PR
/remind 1 day revisit flaky tests
```

---

### `/schedule`

Manage tasks:

```text
/schedule list
/schedule delete <id>
/schedule clear
```

---

### `/unschedule`

Alias for deleting one task:

```text
/unschedule <id>
```

---

## Duration syntax

Accepted units:

- Short: `s`, `m`, `h`, `d` (e.g. `90m`, `2h`)
- Word forms: `seconds`, `minutes`, `hours`, `days` (and common variants like `mins`, `hrs`)

### Rounding behavior

Scheduling is minute-based. Durations are rounded **up** to the nearest minute.

Examples:

- `30s` → `1m`
- `7m 10s` is not a supported compound form (use a single duration token)
- `90m` stays `90m`

---

## Runtime behavior

- Tasks are checked every second.
- If the agent is busy, due tasks are marked pending and run once when idle.
- Pending tasks are dispatched one at a time.
- One-time reminders are removed after firing.
- Recurring tasks are removed 3 days after creation.

---

## Limitations (current version)

- Session-scoped only (tasks stop when pi exits).
- No persistence across restarts.
- No natural-language wall-clock parsing (`at 3pm`) yet.
- No cron-expression input yet.

---

## Local live testing setup (recommended)

To avoid conflicts with a globally installed package while developing, use a filtered npm source plus local override in `.pi/settings.json`:

```json
{
  "packages": [
    {
      "source": "npm:pi-scheduler",
      "extensions": [],
      "skills": [],
      "prompts": [],
      "themes": []
    },
    ".."
  ]
}
```

This keeps npm metadata present but loads extension resources from your local repo.

---

## Development

```bash
npm install
npm run typecheck
```

Run directly with extension flag:

```bash
pi -e ./index.ts
```

---

## Release

### One-off local publish

```bash
npm publish --access public
```

### GitHub Actions publish (recommended)

Workflow file: `.github/workflows/publish.yml`

1. Add repo secret `NPM_TOKEN` (npm Automation token)
2. Bump version in `package.json`
3. Push commit and matching tag:

```bash
npm version patch
git push
git push --tags
```

The workflow will:
- run `npm ci`
- run `npm run typecheck`
- verify tag (`vX.Y.Z`) matches `package.json`
- publish with npm provenance

---

## Troubleshooting

### Commands not available
- Ensure extension is installed: `pi list`
- Run `/reload`
- Confirm package is enabled in `.pi/settings.json` or global settings

### Tasks never fire
- Tasks only fire while pi is running
- They run only when the agent is idle
- Check current queue with `/schedule list`

### Wrong interval behavior
- Use single-token durations (`5m`, `2h`, `1 day`)
- Remember intervals are rounded to minute granularity

---

## License

MIT
