export type TaskKind = "recurring" | "once";

export type TaskStatus = "pending" | "success" | "error";

export interface ScheduleTask {
	id: string;
	prompt: string;
	kind: TaskKind;
	enabled: boolean;
	createdAt: number;
	nextRunAt: number;
	intervalMs?: number;
	cronExpression?: string;
	expiresAt?: number;
	jitterMs: number;
	lastRunAt?: number;
	lastStatus?: TaskStatus;
	runCount: number;
	pending: boolean;
}

export type RecurringSpec =
	| { mode: "interval"; durationMs: number; note?: string }
	| { mode: "cron"; cronExpression: string; note?: string };

export interface ParseResult {
	prompt: string;
	recurring: RecurringSpec;
}

export interface ReminderParseResult {
	prompt: string;
	durationMs: number;
	note?: string;
}

export type SchedulePromptAddPlan =
	| { kind: "once"; durationMs: number; note?: string }
	| { kind: "recurring"; mode: "interval"; durationMs: number; note?: string }
	| { kind: "recurring"; mode: "cron"; cronExpression: string; note?: string };
