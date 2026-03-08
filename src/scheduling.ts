import { Cron } from "croner";
import { DEFAULT_LOOP_INTERVAL, ONE_MINUTE } from "./constants";
import type { ParseResult, ReminderParseResult, SchedulePromptAddPlan, TaskKind } from "./types";

export function normalizeCronExpression(rawInput: string): { expression: string; note?: string } | undefined {
	const input = rawInput.trim();
	if (!input) return undefined;

	const fields = input.split(/\s+/).filter(Boolean);
	if (fields.length !== 5 && fields.length !== 6) return undefined;

	const expression = fields.length === 5 ? `0 ${fields.join(" ")}` : fields.join(" ");
	try {
		const cron = new Cron(expression, () => {});
		cron.stop();
		return {
			expression,
			note: fields.length === 5 ? "Interpreted as 5-field cron and normalized by prepending seconds=0." : undefined,
		};
	} catch {
		return undefined;
	}
}

export function computeNextCronRunAt(expression: string, fromTs = Date.now()): number | undefined {
	try {
		const cron = new Cron(expression, () => {});
		const next = cron.nextRun(new Date(fromTs));
		cron.stop();
		return next?.getTime();
	} catch {
		return undefined;
	}
}

export function formatDurationShort(ms: number): string {
	if (ms % (24 * 60 * ONE_MINUTE) === 0) return `${ms / (24 * 60 * ONE_MINUTE)}d`;
	if (ms % (60 * ONE_MINUTE) === 0) return `${ms / (60 * ONE_MINUTE)}h`;
	return `${ms / ONE_MINUTE}m`;
}

export function normalizeDuration(durationMs: number): { durationMs: number; note?: string } {
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

export function parseDuration(text: string): number | undefined {
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

function extractLeadingCron(input: string): { cronExpression: string; prompt: string; note?: string } | undefined {
	const trimmed = input.trim();
	if (!trimmed.toLowerCase().startsWith("cron ")) return undefined;

	const rest = trimmed.slice(5).trim();
	if (!rest) return undefined;

	const quotedMatch = rest.match(/^(["'])(.+?)\1\s+(.+)$/);
	if (quotedMatch) {
		const normalized = normalizeCronExpression(quotedMatch[2]);
		const prompt = quotedMatch[3].trim();
		if (!normalized || !prompt) return undefined;
		return { cronExpression: normalized.expression, prompt, note: normalized.note };
	}

	const tokens = rest.split(/\s+/);
	for (const fieldCount of [6, 5]) {
		if (tokens.length <= fieldCount) continue;
		const expressionCandidate = tokens.slice(0, fieldCount).join(" ");
		const normalized = normalizeCronExpression(expressionCandidate);
		if (!normalized) continue;
		const prompt = tokens.slice(fieldCount).join(" ").trim();
		if (!prompt) continue;
		return { cronExpression: normalized.expression, prompt, note: normalized.note };
	}

	return undefined;
}

export function parseLoopScheduleArgs(args: string): ParseResult | undefined {
	const input = args.trim();
	if (!input) return undefined;

	const explicitlyCron = input.toLowerCase().startsWith("cron ");
	const leadingCron = extractLeadingCron(input);
	if (leadingCron) {
		return {
			prompt: leadingCron.prompt,
			recurring: {
				mode: "cron",
				cronExpression: leadingCron.cronExpression,
				note: leadingCron.note,
			},
		};
	}
	if (explicitlyCron) return undefined;

	const leading = extractLeadingDuration(input);
	if (leading) {
		const normalized = normalizeDuration(leading.durationMs);
		return {
			prompt: leading.prompt,
			recurring: {
				mode: "interval",
				durationMs: normalized.durationMs,
				note: normalized.note,
			},
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
				recurring: {
					mode: "interval",
					durationMs: normalized.durationMs,
					note: normalized.note,
				},
			};
		}
	}

	return {
		prompt: input,
		recurring: {
			mode: "interval",
			durationMs: DEFAULT_LOOP_INTERVAL,
		},
	};
}

export function parseRemindScheduleArgs(args: string): ReminderParseResult | undefined {
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

export function validateSchedulePromptAddInput(input: {
	kind?: TaskKind;
	duration?: string;
	cron?: string;
}):
	| { ok: true; plan: SchedulePromptAddPlan }
	| { ok: false; error: "missing_duration" | "invalid_duration" | "invalid_cron_for_once" | "conflicting_schedule_inputs" | "invalid_cron" } {
	const kind: TaskKind = input.kind ?? "recurring";

	if (kind === "once") {
		if (input.cron) return { ok: false, error: "invalid_cron_for_once" };
		if (!input.duration) return { ok: false, error: "missing_duration" };

		const parsed = parseDuration(input.duration);
		if (!parsed) return { ok: false, error: "invalid_duration" };
		const normalized = normalizeDuration(parsed);
		return { ok: true, plan: { kind: "once", durationMs: normalized.durationMs, note: normalized.note } };
	}

	if (input.cron && input.duration) return { ok: false, error: "conflicting_schedule_inputs" };

	if (input.cron) {
		const normalizedCron = normalizeCronExpression(input.cron);
		if (!normalizedCron) return { ok: false, error: "invalid_cron" };
		return {
			ok: true,
			plan: { kind: "recurring", mode: "cron", cronExpression: normalizedCron.expression, note: normalizedCron.note },
		};
	}

	if (input.duration) {
		const parsed = parseDuration(input.duration);
		if (!parsed) return { ok: false, error: "invalid_duration" };
		const normalized = normalizeDuration(parsed);
		return { ok: true, plan: { kind: "recurring", mode: "interval", durationMs: normalized.durationMs, note: normalized.note } };
	}

	return {
		ok: true,
		plan: { kind: "recurring", mode: "interval", durationMs: DEFAULT_LOOP_INTERVAL },
	};
}
