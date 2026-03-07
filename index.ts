import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type TaskKind = "recurring" | "once";

interface ScheduleTask {
	id: string;
	prompt: string;
	kind: TaskKind;
	createdAt: number;
	nextRunAt: number;
	intervalMs?: number;
	expiresAt?: number;
	jitterMs: number;
	lastRunAt?: number;
	runCount: number;
	pending: boolean;
}

interface ParseResult {
	prompt: string;
	durationMs: number;
	note?: string;
}

const MAX_TASKS = 50;
const ONE_MINUTE = 60_000;
const FIFTEEN_MINUTES = 15 * ONE_MINUTE;
const THREE_DAYS = 3 * 24 * 60 * ONE_MINUTE;
const DEFAULT_LOOP_INTERVAL = 10 * ONE_MINUTE;

export default function schedulerExtension(pi: ExtensionAPI) {
	const tasks = new Map<string, ScheduleTask>();
	let schedulerTimer: NodeJS.Timeout | undefined;
	let runtimeCtx: ExtensionContext | undefined;
	let dispatching = false;

	function sortedTasks(): ScheduleTask[] {
		return Array.from(tasks.values()).sort((a, b) => a.nextRunAt - b.nextRunAt);
	}

	function truncateText(value: string, max = 64): string {
		if (value.length <= max) return value;
		return `${value.slice(0, Math.max(0, max - 3))}...`;
	}

	function formatClock(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}

	function taskMode(task: ScheduleTask): string {
		if (task.kind === "once") return "once";
		return `every ${formatDurationShort(task.intervalMs ?? DEFAULT_LOOP_INTERVAL)}`;
	}

	function taskOptionLabel(task: ScheduleTask): string {
		return `${task.id} • ${taskMode(task)} • ${formatRelativeTime(task.nextRunAt)} • ${truncateText(task.prompt, 58)}`;
	}

	function updateStatus() {
		if (!runtimeCtx?.hasUI) return;
		if (tasks.size === 0) {
			runtimeCtx.ui.setStatus("pi-scheduler", undefined);
			return;
		}

		const nextRunAt = Math.min(...Array.from(tasks.values()).map((t) => t.nextRunAt));
		const next = new Date(nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		const text = `⏰ ${tasks.size} task${tasks.size === 1 ? "" : "s"} • next ${next}`;
		runtimeCtx.ui.setStatus("pi-scheduler", text);
	}

	function startScheduler() {
		if (schedulerTimer) return;
		schedulerTimer = setInterval(() => {
			void tickScheduler();
		}, 1000);
	}

	function stopScheduler() {
		if (!schedulerTimer) return;
		clearInterval(schedulerTimer);
		schedulerTimer = undefined;
	}

	async function tickScheduler() {
		if (!runtimeCtx) return;

		const now = Date.now();

		for (const task of Array.from(tasks.values())) {
			if (task.kind === "recurring" && task.expiresAt && now >= task.expiresAt) {
				tasks.delete(task.id);
				continue;
			}

			if (now >= task.nextRunAt) {
				task.pending = true;
			}
		}

		updateStatus();

		if (dispatching) return;
		if (!runtimeCtx.isIdle() || runtimeCtx.hasPendingMessages()) return;

		const nextTask = Array.from(tasks.values())
			.filter((task) => task.pending)
			.sort((a, b) => a.nextRunAt - b.nextRunAt)[0];

		if (!nextTask) return;

		dispatching = true;
		try {
			dispatchTask(nextTask);
		} finally {
			dispatching = false;
		}
	}

	function dispatchTask(task: ScheduleTask) {
		const now = Date.now();

		try {
			pi.sendUserMessage(task.prompt);
		} catch {
			task.pending = true;
			return;
		}

		task.pending = false;
		task.lastRunAt = now;
		task.runCount += 1;

		if (task.kind === "once") {
			tasks.delete(task.id);
			updateStatus();
			return;
		}

		const intervalMs = task.intervalMs ?? DEFAULT_LOOP_INTERVAL;
		let next = task.nextRunAt;
		while (next <= now) next += intervalMs;
		task.nextRunAt = next;
		updateStatus();
	}

	function createId(): string {
		let id = "";
		do {
			id = Math.random().toString(36).slice(2, 10);
		} while (tasks.has(id));
		return id;
	}

	function hashString(input: string): number {
		let hash = 2166136261;
		for (let i = 0; i < input.length; i++) {
			hash ^= input.charCodeAt(i);
			hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
		}
		return hash >>> 0;
	}

	function computeJitterMs(taskId: string, intervalMs: number): number {
		const maxJitter = Math.min(Math.floor(intervalMs * 0.1), FIFTEEN_MINUTES);
		if (maxJitter <= 0) return 0;
		return hashString(taskId) % (maxJitter + 1);
	}

	function normalizeDuration(durationMs: number): { durationMs: number; note?: string } {
		if (durationMs <= 0) {
			return { durationMs: ONE_MINUTE, note: "Rounded up to 1m (minimum interval)." };
		}

		const rounded = Math.ceil(durationMs / ONE_MINUTE) * ONE_MINUTE;
		if (rounded !== durationMs) {
			return {
				durationMs: rounded,
				note: `Rounded to ${formatDurationShort(rounded)} (minute granularity).`,
			};
		}
		return { durationMs };
	}

	function parseDuration(text: string): number | undefined {
		const raw = text.trim().toLowerCase();
		if (!raw) return undefined;

		let match = raw.match(/^(\d+)\s*([smhd])$/i);
		if (match) {
			const n = Number.parseInt(match[1], 10);
			const unit = match[2].toLowerCase();
			if (unit === "s") return n * 1000;
			if (unit === "m") return n * ONE_MINUTE;
			if (unit === "h") return n * 60 * ONE_MINUTE;
			if (unit === "d") return n * 24 * 60 * ONE_MINUTE;
		}

		match = raw.match(/^(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)$/i);
		if (!match) return undefined;
		const n = Number.parseInt(match[1], 10);
		const unit = match[2].toLowerCase();
		if (unit.startsWith("sec")) return n * 1000;
		if (unit.startsWith("min")) return n * ONE_MINUTE;
		if (unit.startsWith("hour") || unit.startsWith("hr")) return n * 60 * ONE_MINUTE;
		if (unit.startsWith("day")) return n * 24 * 60 * ONE_MINUTE;
		return undefined;
	}

	function extractLeadingDuration(input: string): { durationMs: number; prompt: string } | undefined {
		const tokens = input.trim().split(/\s+/);
		if (tokens.length < 2) return undefined;

		const maxPrefix = Math.min(3, tokens.length - 1);
		for (let i = 1; i <= maxPrefix; i++) {
			const durationCandidate = tokens.slice(0, i).join(" ");
			const durationMs = parseDuration(durationCandidate);
			if (!durationMs) continue;
			const prompt = tokens.slice(i).join(" ").trim();
			if (!prompt) continue;
			return { durationMs, prompt };
		}

		return undefined;
	}

	function parseLoopArgs(args: string): ParseResult | undefined {
		const input = args.trim();
		if (!input) return undefined;

		const leading = extractLeadingDuration(input);
		if (leading) {
			const normalized = normalizeDuration(leading.durationMs);
			return {
				prompt: leading.prompt,
				durationMs: normalized.durationMs,
				note: normalized.note,
			};
		}

		const trailingEvery = input.match(/^(.*)\s+every\s+(.+)$/i);
		if (trailingEvery) {
			const prompt = trailingEvery[1].trim();
			const parsed = parseDuration(trailingEvery[2]);
			if (prompt && parsed) {
				const normalized = normalizeDuration(parsed);
				return {
					prompt,
					durationMs: normalized.durationMs,
					note: normalized.note,
				};
			}
		}

		return {
			prompt: input,
			durationMs: DEFAULT_LOOP_INTERVAL,
		};
	}

	function parseRemindArgs(args: string): ParseResult | undefined {
		const input = args.trim();
		if (!input) return undefined;

		const value = input.toLowerCase().startsWith("in ") ? input.slice(3).trim() : input;
		const parsed = extractLeadingDuration(value);
		if (!parsed) return undefined;

		const normalized = normalizeDuration(parsed.durationMs);
		return {
			prompt: parsed.prompt,
			durationMs: normalized.durationMs,
			note: normalized.note,
		};
	}

	function formatDurationShort(ms: number): string {
		if (ms % (24 * 60 * ONE_MINUTE) === 0) return `${ms / (24 * 60 * ONE_MINUTE)}d`;
		if (ms % (60 * ONE_MINUTE) === 0) return `${ms / (60 * ONE_MINUTE)}h`;
		return `${ms / ONE_MINUTE}m`;
	}

	function formatRelativeTime(timestamp: number): string {
		const delta = timestamp - Date.now();
		if (delta <= 0) return "due now";
		const mins = Math.round(delta / ONE_MINUTE);
		if (mins < 60) return `in ${Math.max(mins, 1)}m`;
		const hours = Math.round(mins / 60);
		if (hours < 48) return `in ${hours}h`;
		const days = Math.round(hours / 24);
		return `in ${days}d`;
	}

	function formatTaskList(): string {
		const list = sortedTasks();
		if (list.length === 0) return "No scheduled tasks.";

		const lines = ["Scheduled tasks:", ""];
		for (const task of list) {
			const mode = taskMode(task);
			const next = `${formatRelativeTime(task.nextRunAt)} (${formatClock(task.nextRunAt)})`;
			const preview = task.prompt.length > 72 ? `${task.prompt.slice(0, 69)}...` : task.prompt;
			lines.push(`${task.id}  ${mode}  next ${next}`);
			lines.push(`  ${preview}`);
		}
		return lines.join("\n");
	}

	function addRecurringTask(prompt: string, intervalMs: number) {
		const id = createId();
		const createdAt = Date.now();
		const jitterMs = computeJitterMs(id, intervalMs);
		const nextRunAt = createdAt + intervalMs + jitterMs;
		const task: ScheduleTask = {
			id,
			prompt,
			kind: "recurring",
			createdAt,
			nextRunAt,
			intervalMs,
			expiresAt: createdAt + THREE_DAYS,
			jitterMs,
			runCount: 0,
			pending: false,
		};
		tasks.set(id, task);
		updateStatus();
		return task;
	}

	function addOneShotTask(prompt: string, delayMs: number) {
		const id = createId();
		const createdAt = Date.now();
		const task: ScheduleTask = {
			id,
			prompt,
			kind: "once",
			createdAt,
			nextRunAt: createdAt + delayMs,
			jitterMs: 0,
			runCount: 0,
			pending: false,
		};
		tasks.set(id, task);
		updateStatus();
		return task;
	}

	async function openTaskManager(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) {
			pi.sendMessage({
				customType: "pi-scheduler",
				content: formatTaskList(),
				display: true,
			});
			return;
		}

		while (true) {
			const list = sortedTasks();
			if (list.length === 0) {
				ctx.ui.notify("No scheduled tasks.", "info");
				return;
			}

			const options = list.map(taskOptionLabel);
			options.push("➕ Close");

			const selected = await ctx.ui.select("Scheduled tasks (select one)", options);
			if (!selected || selected === "➕ Close") return;

			const taskId = selected.slice(0, 8);
			const task = tasks.get(taskId);
			if (!task) {
				ctx.ui.notify("Task no longer exists. Refreshing list...", "warning");
				continue;
			}

			const closed = await openTaskActions(ctx, task.id);
			if (closed) return;
		}
	}

	async function openTaskActions(ctx: ExtensionContext, taskId: string): Promise<boolean> {
		while (true) {
			const task = tasks.get(taskId);
			if (!task) {
				ctx.ui.notify("Task no longer exists.", "warning");
				return false;
			}

			const title = `${task.id} • ${taskMode(task)} • next ${formatRelativeTime(task.nextRunAt)} (${formatClock(task.nextRunAt)})`;
			const options = [
				task.kind === "recurring" ? "⏱ Change interval" : "⏱ Change reminder delay",
				"▶ Run now",
				"🗑 Delete",
				"↩ Back",
				"✕ Close",
			];
			const action = await ctx.ui.select(title, options);

			if (!action || action === "↩ Back") return false;
			if (action === "✕ Close") return true;

			if (action === "🗑 Delete") {
				const ok = await ctx.ui.confirm("Delete scheduled task?", `${task.id}: ${task.prompt}`);
				if (!ok) continue;
				tasks.delete(task.id);
				updateStatus();
				ctx.ui.notify(`Deleted scheduled task ${task.id}.`, "info");
				return false;
			}

			if (action === "▶ Run now") {
				task.nextRunAt = Date.now();
				task.pending = true;
				updateStatus();
				void tickScheduler();
				ctx.ui.notify(`Queued ${task.id} to run now.`, "info");
				continue;
			}

			if (action.startsWith("⏱")) {
				const defaultValue =
					task.kind === "recurring"
						? formatDurationShort(task.intervalMs ?? DEFAULT_LOOP_INTERVAL)
						: formatDurationShort(Math.max(task.nextRunAt - Date.now(), ONE_MINUTE));

				const raw = await ctx.ui.input(
					task.kind === "recurring" ? "New interval (e.g. 5m, 2h)" : "New delay from now (e.g. 30m, 2h)",
					defaultValue,
				);
				if (!raw) continue;

				const parsed = parseDuration(raw);
				if (!parsed) {
					ctx.ui.notify("Invalid duration. Try values like 5m, 2h, or 1 day.", "warning");
					continue;
				}

				const normalized = normalizeDuration(parsed);
				if (task.kind === "recurring") {
					task.intervalMs = normalized.durationMs;
					task.jitterMs = computeJitterMs(task.id, normalized.durationMs);
					task.nextRunAt = Date.now() + normalized.durationMs + task.jitterMs;
					task.pending = false;
					ctx.ui.notify(`Updated ${task.id} to every ${formatDurationShort(normalized.durationMs)}.`, "info");
				} else {
					task.nextRunAt = Date.now() + normalized.durationMs;
					task.pending = false;
					ctx.ui.notify(`Updated ${task.id} reminder to ${formatRelativeTime(task.nextRunAt)}.`, "info");
				}
				if (normalized.note) ctx.ui.notify(normalized.note, "info");
				updateStatus();
			}
		}
	}

	pi.registerCommand("loop", {
		description: "Schedule recurring prompt: /loop 5m <prompt> or /loop <prompt> every 2h",
		handler: async (args, ctx) => {
			const parsed = parseLoopArgs(args);
			if (!parsed) {
				ctx.ui.notify("Usage: /loop 5m check build", "warning");
				return;
			}

			if (tasks.size >= MAX_TASKS) {
				ctx.ui.notify(`Task limit reached (${MAX_TASKS}). Delete one with /schedule delete <id>.`, "error");
				return;
			}

			const task = addRecurringTask(parsed.prompt, parsed.durationMs);
			ctx.ui.notify(
				`Scheduled every ${formatDurationShort(parsed.durationMs)} (id: ${task.id}). Expires in 3 days.`,
				"info",
			);
			if (parsed.note) ctx.ui.notify(parsed.note, "info");
		},
	});

	pi.registerCommand("remind", {
		description: "Schedule one-time reminder: /remind in 45m <prompt>",
		handler: async (args, ctx) => {
			const parsed = parseRemindArgs(args);
			if (!parsed) {
				ctx.ui.notify("Usage: /remind in 45m check deployment", "warning");
				return;
			}

			if (tasks.size >= MAX_TASKS) {
				ctx.ui.notify(`Task limit reached (${MAX_TASKS}). Delete one with /schedule delete <id>.`, "error");
				return;
			}

			const task = addOneShotTask(parsed.prompt, parsed.durationMs);
			ctx.ui.notify(`Reminder set for ${formatRelativeTime(task.nextRunAt)} (id: ${task.id}).`, "info");
			if (parsed.note) ctx.ui.notify(parsed.note, "info");
		},
	});

	pi.registerCommand("schedule", {
		description: "Manage schedules. No args opens TUI manager. Also: list | delete <id> | clear",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed || trimmed === "tui") {
				await openTaskManager(ctx);
				return;
			}

			const [rawAction, rawArg] = trimmed.split(/\s+/, 2);
			const action = rawAction.toLowerCase();

			if (action === "list") {
				pi.sendMessage({
					customType: "pi-scheduler",
					content: formatTaskList(),
					display: true,
				});
				return;
			}

			if (action === "delete" || action === "remove" || action === "rm") {
				if (!rawArg) {
					ctx.ui.notify("Usage: /schedule delete <id>", "warning");
					return;
				}
				const removed = tasks.delete(rawArg);
				if (!removed) {
					ctx.ui.notify(`Task not found: ${rawArg}`, "warning");
					return;
				}
				updateStatus();
				ctx.ui.notify(`Deleted scheduled task ${rawArg}.`, "info");
				return;
			}

			if (action === "clear") {
				const count = tasks.size;
				tasks.clear();
				updateStatus();
				ctx.ui.notify(`Cleared ${count} task${count === 1 ? "" : "s"}.`, "info");
				return;
			}

			ctx.ui.notify("Usage: /schedule [tui|list|delete <id>|clear]", "warning");
		},
	});

	pi.registerCommand("unschedule", {
		description: "Alias for /schedule delete <id>",
		handler: async (args, ctx) => {
			const id = args.trim();
			if (!id) {
				ctx.ui.notify("Usage: /unschedule <id>", "warning");
				return;
			}
			const removed = tasks.delete(id);
			if (!removed) {
				ctx.ui.notify(`Task not found: ${id}`, "warning");
				return;
			}
			updateStatus();
			ctx.ui.notify(`Deleted scheduled task ${id}.`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		runtimeCtx = ctx;
		startScheduler();
		updateStatus();
	});

	pi.on("session_switch", async (_event, ctx) => {
		runtimeCtx = ctx;
		updateStatus();
	});

	pi.on("session_fork", async (_event, ctx) => {
		runtimeCtx = ctx;
		updateStatus();
	});

	pi.on("session_tree", async (_event, ctx) => {
		runtimeCtx = ctx;
		updateStatus();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		runtimeCtx = ctx;
		stopScheduler();
		if (ctx.hasUI) ctx.ui.setStatus("pi-scheduler", undefined);
	});
}
