# pi-scheduler

Simple scheduler extension for [pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent).

Use it to run recurring checks (`/loop`) and one-time reminders (`/remind`) while you work in an active pi session.

It also exposes an LLM-callable tool (`schedule_prompt`), so the agent can create/list/delete schedules directly when you ask in natural language.

## Install

```bash
pi install npm:pi-scheduler
```

Then restart pi or run:

```text
/reload
```

## Agent tool (`schedule_prompt`)

The agent can call this tool with actions:

- `add` (supports `kind: recurring|once`, `prompt`, and either `duration` or `cron` for recurring)
- `list` (includes state/run stats)
- `enable` (`id`)
- `disable` (`id`)
- `delete` (`id`)
- `clear`

Recurring schedules can be interval-based (`duration`, e.g. `5m`) or cron-based (`cron`, e.g. `*/5 * * * *`).

## Commands

### `/loop`
Create a recurring scheduled prompt.

Examples:

```text
/loop 5m check if CI is green
/loop check deployment every 2h
/loop cron */5 * * * * check build status
/loop check build status
```

If no interval is provided, default is every **10 minutes**.

### `/remind`
Create a one-time reminder.

Examples:

```text
/remind in 45m check integration tests
/remind 2h follow up on release PR
```

### `/schedule`
Manage scheduled tasks.

```text
/schedule
```

With no args, this opens an interactive TUI manager where you can:
- select a task
- change schedule/delay (interval or cron for recurring tasks)
- run it now
- delete it

CLI subcommands also work:

```text
/schedule list
/schedule enable <id>
/schedule disable <id>
/schedule delete <id>
/schedule clear
```

### `/unschedule`
Alias for deleting one task.

```text
/unschedule <id>
```

## Scheduling formats

### Duration format

Accepted units:

- Short: `s`, `m`, `h`, `d` (e.g. `30s`, `5m`, `2h`, `1d`)
- Word forms: `seconds`, `minutes`, `hours`, `days` (and common variants like `mins`, `hrs`)

Interval scheduling uses minute granularity, so durations are rounded up to the nearest minute.

### Cron format

Recurring tasks also support cron expressions.

- 5-field: `minute hour day-of-month month day-of-week` (Claude-style)
- 6-field: `second minute hour day-of-month month day-of-week`

Examples:

- `*/5 * * * *` → every 5 minutes (normalized internally to `0 */5 * * * *`)
- `0 0 9 * * 1-5` → weekdays at 9:00

## Behavior

- Tasks are checked every second.
- Tasks are persisted to `.pi/scheduler.json` and reloaded on next session start.
- Tasks run only when pi is idle (between turns).
- If a task becomes due while busy, it runs once when pi is idle.
- One-time tasks remove themselves after running.
- Recurring tasks auto-expire after 3 days.
- Tasks can be enabled/disabled without deleting.
- List views include run stats (`runCount`, last run, last status).
- Max 50 active tasks.

## Limitations

- Session-scoped execution only (tasks fire while pi is running).
- No wall-clock parsing (`at 3pm`) yet.

## Troubleshooting

### Commands not available
- Run `/reload`
- Check install with `pi list`
- Ensure package is enabled in pi settings

### Tasks never fire
- Keep pi running (tasks are not background jobs)
- Tasks only fire when pi is idle
- Check pending tasks with `/schedule list`
- Ensure task is enabled (`/schedule enable <id>`)

## Development

```bash
npm run typecheck
npm test
npm run check
```

## Project structure

- `index.ts` — thin package entrypoint
- `src/index.ts` — extension wiring
- `src/runtime.ts` — scheduler state/runtime + task manager UI flow
- `src/commands.ts` — slash commands (`/loop`, `/remind`, `/schedule`, `/unschedule`)
- `src/tools.ts` — `schedule_prompt` tool
- `src/events.ts` — session lifecycle event handlers
- `src/scheduling.ts` — parsing/validation helpers (duration + cron)
- `src/types.ts` / `src/constants.ts` — shared types/constants

## License

MIT
