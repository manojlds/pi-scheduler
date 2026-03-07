# pi-scheduler

Simple scheduler extension for [pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent).

Use it to run recurring checks (`/loop`) and one-time reminders (`/remind`) while you work in an active pi session.

## Install

```bash
pi install npm:pi-scheduler
```

Then restart pi or run:

```text
/reload
```

## Commands

### `/loop`
Create a recurring scheduled prompt.

Examples:

```text
/loop 5m check if CI is green
/loop check deployment every 2h
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
- change interval/delay
- run it now
- delete it

CLI subcommands also work:

```text
/schedule list
/schedule delete <id>
/schedule clear
```

### `/unschedule`
Alias for deleting one task.

```text
/unschedule <id>
```

## Duration format

Accepted units:

- Short: `s`, `m`, `h`, `d` (e.g. `30s`, `5m`, `2h`, `1d`)
- Word forms: `seconds`, `minutes`, `hours`, `days` (and common variants like `mins`, `hrs`)

Scheduling uses minute granularity, so durations are rounded up to the nearest minute.

## Behavior

- Tasks are checked every second.
- Tasks run only when pi is idle (between turns).
- If a task becomes due while busy, it runs once when pi is idle.
- One-time tasks remove themselves after running.
- Recurring tasks auto-expire after 3 days.
- Max 50 active tasks.

## Limitations

- Session-scoped only (tasks stop when pi exits).
- No persistence across restarts.
- No wall-clock parsing (`at 3pm`) yet.
- No raw cron-expression input yet.

## Troubleshooting

### Commands not available
- Run `/reload`
- Check install with `pi list`
- Ensure package is enabled in pi settings

### Tasks never fire
- Keep pi running (tasks are not background jobs)
- Tasks only fire when pi is idle
- Check pending tasks with `/schedule list`

## License

MIT
