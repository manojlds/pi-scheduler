import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DEFAULT_LOOP_INTERVAL, FIFTEEN_MINUTES, ONE_MINUTE, THREE_DAYS } from "./constants";
import {
	computeNextCronRunAt,
	formatDurationShort,
	normalizeCronExpression,
	normalizeDuration,
	parseDuration,
} from "./scheduling";
import type { ScheduleTask } from "./types";

interface SchedulerStore {
	version: 1;
	tasks: ScheduleTask[];
}

export class SchedulerRuntime {
	private readonly tasks = new Map<string, ScheduleTask>();
	private schedulerTimer: NodeJS.Timeout | undefined;
	private runtimeCtx: ExtensionContext | undefined;
	private dispatching = false;
	private storagePath: string | undefined;

	constructor(private readonly pi: ExtensionAPI) {}

	get taskCount(): number {
		return this.tasks.size;
	}

	setRuntimeContext(ctx: ExtensionContext | undefined) {
		this.runtimeCtx = ctx;
		if (!ctx?.cwd) return;

		const nextStorePath = path.join(ctx.cwd, ".pi", "scheduler.json");
		if (nextStorePath !== this.storagePath) {
			this.storagePath = nextStorePath;
			this.loadTasksFromDisk();
		}
	}

	clearStatus(ctx?: ExtensionContext) {
		const target = ctx ?? this.runtimeCtx;
		if (target?.hasUI) target.ui.setStatus("pi-scheduler", undefined);
	}

	getSortedTasks(): ScheduleTask[] {
		return Array.from(this.tasks.values()).sort((a, b) => a.nextRunAt - b.nextRunAt);
	}

	getTask(id: string): ScheduleTask | undefined {
		return this.tasks.get(id);
	}

	setTaskEnabled(id: string, enabled: boolean): boolean {
		const task = this.tasks.get(id);
		if (!task) return false;
		task.enabled = enabled;
		if (!enabled) task.pending = false;
		this.persistTasks();
		this.updateStatus();
		return true;
	}

	deleteTask(id: string): boolean {
		const removed = this.tasks.delete(id);
		if (removed) {
			this.persistTasks();
			this.updateStatus();
		}
		return removed;
	}

	clearTasks(): number {
		const count = this.tasks.size;
		this.tasks.clear();
		this.persistTasks();
		this.updateStatus();
		return count;
	}

	formatRelativeTime(timestamp: number): string {
		const delta = timestamp - Date.now();
		if (delta <= 0) return "due now";
		const mins = Math.round(delta / ONE_MINUTE);
		if (mins < 60) return `in ${Math.max(mins, 1)}m`;
		const hours = Math.round(mins / 60);
		if (hours < 48) return `in ${hours}h`;
		const days = Math.round(hours / 24);
		return `in ${days}d`;
	}

	formatTaskList(): string {
		const list = this.getSortedTasks();
		if (list.length === 0) return "No scheduled tasks.";

		const lines = ["Scheduled tasks:", ""];
		for (const task of list) {
			const state = task.enabled ? "on" : "off";
			const mode = this.taskMode(task);
			const next = `${this.formatRelativeTime(task.nextRunAt)} (${this.formatClock(task.nextRunAt)})`;
			const last = task.lastRunAt ? `${this.formatRelativeTime(task.lastRunAt)} (${this.formatClock(task.lastRunAt)})` : "never";
			const status = task.lastStatus ?? "pending";
			const preview = task.prompt.length > 72 ? `${task.prompt.slice(0, 69)}...` : task.prompt;
			lines.push(`${task.id}  ${state}  ${mode}  next ${next}`);
			lines.push(`  runs=${task.runCount}  last=${last}  status=${status}`);
			lines.push(`  ${preview}`);
		}
		return lines.join("\n");
	}

	addRecurringIntervalTask(prompt: string, intervalMs: number): ScheduleTask {
		const id = this.createId();
		const createdAt = Date.now();
		const jitterMs = this.computeJitterMs(id, intervalMs);
		const nextRunAt = createdAt + intervalMs + jitterMs;
		const task: ScheduleTask = {
			id,
			prompt,
			kind: "recurring",
			enabled: true,
			createdAt,
			nextRunAt,
			intervalMs,
			expiresAt: createdAt + THREE_DAYS,
			jitterMs,
			runCount: 0,
			pending: false,
		};
		this.tasks.set(id, task);
		this.persistTasks();
		this.updateStatus();
		return task;
	}

	addRecurringCronTask(prompt: string, cronExpression: string): ScheduleTask | undefined {
		const id = this.createId();
		const createdAt = Date.now();
		const nextRunAt = computeNextCronRunAt(cronExpression, createdAt);
		if (!nextRunAt) return undefined;

		const task: ScheduleTask = {
			id,
			prompt,
			kind: "recurring",
			enabled: true,
			createdAt,
			nextRunAt,
			cronExpression,
			expiresAt: createdAt + THREE_DAYS,
			jitterMs: 0,
			runCount: 0,
			pending: false,
		};
		this.tasks.set(id, task);
		this.persistTasks();
		this.updateStatus();
		return task;
	}

	addOneShotTask(prompt: string, delayMs: number): ScheduleTask {
		const id = this.createId();
		const createdAt = Date.now();
		const task: ScheduleTask = {
			id,
			prompt,
			kind: "once",
			enabled: true,
			createdAt,
			nextRunAt: createdAt + delayMs,
			jitterMs: 0,
			runCount: 0,
			pending: false,
		};
		this.tasks.set(id, task);
		this.persistTasks();
		this.updateStatus();
		return task;
	}

	startScheduler() {
		if (this.schedulerTimer) return;
		this.schedulerTimer = setInterval(() => {
			void this.tickScheduler();
		}, 1000);
	}

	stopScheduler() {
		if (!this.schedulerTimer) return;
		clearInterval(this.schedulerTimer);
		this.schedulerTimer = undefined;
	}

	updateStatus() {
		if (!this.runtimeCtx?.hasUI) return;
		if (this.tasks.size === 0) {
			this.runtimeCtx.ui.setStatus("pi-scheduler", undefined);
			return;
		}

		const enabled = Array.from(this.tasks.values()).filter((t) => t.enabled);
		if (enabled.length === 0) {
			this.runtimeCtx.ui.setStatus("pi-scheduler", `⏸ ${this.tasks.size} task${this.tasks.size === 1 ? "" : "s"} paused`);
			return;
		}

		const nextRunAt = Math.min(...enabled.map((t) => t.nextRunAt));
		const next = new Date(nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		const text = `⏰ ${enabled.length} active • next ${next}`;
		this.runtimeCtx.ui.setStatus("pi-scheduler", text);
	}

	async tickScheduler() {
		if (!this.runtimeCtx) return;

		const now = Date.now();
		let mutated = false;

		for (const task of Array.from(this.tasks.values())) {
			if (task.kind === "recurring" && task.expiresAt && now >= task.expiresAt) {
				this.tasks.delete(task.id);
				mutated = true;
				continue;
			}

			if (!task.enabled) continue;
			if (now >= task.nextRunAt) {
				task.pending = true;
			}
		}

		if (mutated) this.persistTasks();
		this.updateStatus();

		if (this.dispatching) return;
		if (!this.runtimeCtx.isIdle() || this.runtimeCtx.hasPendingMessages()) return;

		const nextTask = Array.from(this.tasks.values())
			.filter((task) => task.enabled && task.pending)
			.sort((a, b) => a.nextRunAt - b.nextRunAt)[0];

		if (!nextTask) return;

		this.dispatching = true;
		try {
			this.dispatchTask(nextTask);
		} finally {
			this.dispatching = false;
		}
	}

	async openTaskManager(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) {
			this.pi.sendMessage({
				customType: "pi-scheduler",
				content: this.formatTaskList(),
				display: true,
			});
			return;
		}

		while (true) {
			const list = this.getSortedTasks();
			if (list.length === 0) {
				ctx.ui.notify("No scheduled tasks.", "info");
				return;
			}

			const options = list.map((task) => this.taskOptionLabel(task));
			options.push("➕ Close");

			const selected = await ctx.ui.select("Scheduled tasks (select one)", options);
			if (!selected || selected === "➕ Close") return;

			const taskId = selected.slice(0, 8);
			const task = this.tasks.get(taskId);
			if (!task) {
				ctx.ui.notify("Task no longer exists. Refreshing list...", "warning");
				continue;
			}

			const closed = await this.openTaskActions(ctx, task.id);
			if (closed) return;
		}
	}

	private async openTaskActions(ctx: ExtensionContext, taskId: string): Promise<boolean> {
		while (true) {
			const task = this.tasks.get(taskId);
			if (!task) {
				ctx.ui.notify("Task no longer exists.", "warning");
				return false;
			}

			const title = `${task.id} • ${this.taskMode(task)} • next ${this.formatRelativeTime(task.nextRunAt)} (${this.formatClock(task.nextRunAt)})`;
			const options = [
				task.kind === "recurring" ? "⏱ Change schedule" : "⏱ Change reminder delay",
				task.enabled ? "⏸ Disable" : "▶ Enable",
				"▶ Run now",
				"🗑 Delete",
				"↩ Back",
				"✕ Close",
			];
			const action = await ctx.ui.select(title, options);

			if (!action || action === "↩ Back") return false;
			if (action === "✕ Close") return true;

			if (action === "⏸ Disable" || action === "▶ Enable") {
				const enabled = action === "▶ Enable";
				this.setTaskEnabled(task.id, enabled);
				ctx.ui.notify(`${enabled ? "Enabled" : "Disabled"} scheduled task ${task.id}.`, "info");
				continue;
			}

			if (action === "🗑 Delete") {
				const ok = await ctx.ui.confirm("Delete scheduled task?", `${task.id}: ${task.prompt}`);
				if (!ok) continue;
				this.tasks.delete(task.id);
				this.persistTasks();
				this.updateStatus();
				ctx.ui.notify(`Deleted scheduled task ${task.id}.`, "info");
				return false;
			}

			if (action === "▶ Run now") {
				task.nextRunAt = Date.now();
				task.pending = true;
				this.persistTasks();
				this.updateStatus();
				void this.tickScheduler();
				ctx.ui.notify(`Queued ${task.id} to run now.`, "info");
				continue;
			}

			if (action.startsWith("⏱")) {
				const defaultValue =
					task.kind === "recurring"
						? task.cronExpression ?? formatDurationShort(task.intervalMs ?? DEFAULT_LOOP_INTERVAL)
						: formatDurationShort(Math.max(task.nextRunAt - Date.now(), ONE_MINUTE));

				const raw = await ctx.ui.input(
					task.kind === "recurring"
						? "New interval or cron (e.g. 5m or 0 */10 * * * *)"
						: "New delay from now (e.g. 30m, 2h)",
					defaultValue,
				);
				if (!raw) continue;

				if (task.kind === "recurring") {
					const parsedDuration = parseDuration(raw);
					if (parsedDuration) {
						const normalized = normalizeDuration(parsedDuration);
						task.intervalMs = normalized.durationMs;
						task.cronExpression = undefined;
						task.jitterMs = this.computeJitterMs(task.id, normalized.durationMs);
						task.nextRunAt = Date.now() + normalized.durationMs + task.jitterMs;
						task.pending = false;
						this.persistTasks();
						ctx.ui.notify(`Updated ${task.id} to every ${formatDurationShort(normalized.durationMs)}.`, "info");
						if (normalized.note) ctx.ui.notify(normalized.note, "info");
						this.updateStatus();
						continue;
					}

					const normalizedCron = normalizeCronExpression(raw);
					if (!normalizedCron) {
						ctx.ui.notify("Invalid input. Use interval like 5m or cron like 0 */10 * * * *.", "warning");
						continue;
					}

					const nextRunAt = computeNextCronRunAt(normalizedCron.expression);
					if (!nextRunAt) {
						ctx.ui.notify("Could not compute next cron run time.", "warning");
						continue;
					}

					task.intervalMs = undefined;
					task.cronExpression = normalizedCron.expression;
					task.jitterMs = 0;
					task.nextRunAt = nextRunAt;
					task.pending = false;
					this.persistTasks();
					ctx.ui.notify(`Updated ${task.id} to cron ${normalizedCron.expression}.`, "info");
					if (normalizedCron.note) ctx.ui.notify(normalizedCron.note, "info");
					this.updateStatus();
					continue;
				}

				const parsed = parseDuration(raw);
				if (!parsed) {
					ctx.ui.notify("Invalid duration. Try values like 5m, 2h, or 1 day.", "warning");
					continue;
				}

				const normalized = normalizeDuration(parsed);
				task.nextRunAt = Date.now() + normalized.durationMs;
				task.pending = false;
				this.persistTasks();
				ctx.ui.notify(`Updated ${task.id} reminder to ${this.formatRelativeTime(task.nextRunAt)}.`, "info");
				if (normalized.note) ctx.ui.notify(normalized.note, "info");
				this.updateStatus();
			}
		}
	}

	private dispatchTask(task: ScheduleTask) {
		if (!task.enabled) return;
		const now = Date.now();

		try {
			this.pi.sendUserMessage(task.prompt);
		} catch {
			task.pending = true;
			task.lastStatus = "error";
			this.persistTasks();
			return;
		}

		task.pending = false;
		task.lastRunAt = now;
		task.lastStatus = "success";
		task.runCount += 1;

		if (task.kind === "once") {
			this.tasks.delete(task.id);
			this.persistTasks();
			this.updateStatus();
			return;
		}

		if (task.cronExpression) {
			const next = computeNextCronRunAt(task.cronExpression, now + 1_000);
			if (!next) {
				this.tasks.delete(task.id);
				this.persistTasks();
				this.updateStatus();
				return;
			}
			task.nextRunAt = next;
			this.persistTasks();
			this.updateStatus();
			return;
		}

		const intervalMs = task.intervalMs ?? DEFAULT_LOOP_INTERVAL;
		let next = task.nextRunAt;
		while (next <= now) next += intervalMs;
		task.nextRunAt = next;
		this.persistTasks();
		this.updateStatus();
	}

	private createId(): string {
		let id = "";
		do {
			id = Math.random().toString(36).slice(2, 10);
		} while (this.tasks.has(id));
		return id;
	}

	private taskMode(task: ScheduleTask): string {
		if (task.kind === "once") return "once";
		if (task.cronExpression) return `cron ${task.cronExpression}`;
		return `every ${formatDurationShort(task.intervalMs ?? DEFAULT_LOOP_INTERVAL)}`;
	}

	private taskOptionLabel(task: ScheduleTask): string {
		const state = task.enabled ? "✓" : "⏸";
		return `${task.id} • ${state} ${this.taskMode(task)} • ${this.formatRelativeTime(task.nextRunAt)} • ${this.truncateText(task.prompt, 50)}`;
	}

	private truncateText(value: string, max = 64): string {
		if (value.length <= max) return value;
		return `${value.slice(0, Math.max(0, max - 3))}...`;
	}

	private formatClock(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}

	private hashString(input: string): number {
		let hash = 2166136261;
		for (let i = 0; i < input.length; i++) {
			hash ^= input.charCodeAt(i);
			hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
		}
		return hash >>> 0;
	}

	private computeJitterMs(taskId: string, intervalMs: number): number {
		const maxJitter = Math.min(Math.floor(intervalMs * 0.1), FIFTEEN_MINUTES);
		if (maxJitter <= 0) return 0;
		return this.hashString(taskId) % (maxJitter + 1);
	}

	private loadTasksFromDisk() {
		if (!this.storagePath) return;

		this.tasks.clear();
		try {
			if (!fs.existsSync(this.storagePath)) return;
			const raw = fs.readFileSync(this.storagePath, "utf-8");
			const parsed = JSON.parse(raw) as SchedulerStore;
			const list = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
			const now = Date.now();
			for (const task of list) {
				if (!task || !task.id || !task.prompt) continue;
				const normalized: ScheduleTask = {
					...task,
					enabled: task.enabled ?? true,
					pending: false,
					runCount: task.runCount ?? 0,
				};
				if (normalized.kind === "recurring" && normalized.expiresAt && now >= normalized.expiresAt) {
					continue;
				}
				this.tasks.set(normalized.id, normalized);
			}
		} catch {
			// Ignore corrupted store and continue with empty in-memory state.
		}
		this.updateStatus();
	}

	private persistTasks() {
		if (!this.storagePath) return;
		try {
			fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
			const store: SchedulerStore = {
				version: 1,
				tasks: this.getSortedTasks(),
			};
			const tempPath = `${this.storagePath}.tmp`;
			fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf-8");
			fs.renameSync(tempPath, this.storagePath);
		} catch {
			// Best-effort persistence; runtime behavior should continue.
		}
	}
}
