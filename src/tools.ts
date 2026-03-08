import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type Static, Type } from "@sinclair/typebox";
import { DEFAULT_LOOP_INTERVAL, MAX_TASKS } from "./constants";
import { formatDurationShort, validateSchedulePromptAddInput } from "./scheduling";
import { SchedulerRuntime } from "./runtime";

const SchedulePromptToolParams = Type.Object({
	action: Type.Union(
		[
			Type.Literal("add"),
			Type.Literal("list"),
			Type.Literal("delete"),
			Type.Literal("clear"),
			Type.Literal("enable"),
			Type.Literal("disable"),
		],
		{
			description: "Action to perform",
		},
	),
	kind: Type.Optional(Type.Union([Type.Literal("recurring"), Type.Literal("once")], { description: "Task kind" })),
	prompt: Type.Optional(Type.String({ description: "Prompt text to run when the task fires" })),
	duration: Type.Optional(
		Type.String({
			description:
				"Delay/interval like 5m, 2h, 1 day. For kind=once this is required. For kind=recurring this creates interval-based loops.",
		}),
	),
	cron: Type.Optional(
		Type.String({
			description:
				"Cron expression for recurring tasks. Accepts 5-field (minute hour dom month dow) or 6-field (sec minute hour dom month dow).",
		}),
	),
	id: Type.Optional(Type.String({ description: "Task id for delete action" })),
});

type SchedulePromptToolParamsType = Static<typeof SchedulePromptToolParams>;

export function registerTools(pi: ExtensionAPI, runtime: SchedulerRuntime) {
	pi.registerTool({
		name: "schedule_prompt",
		label: "Schedule Prompt",
		description:
			"Create/list/enable/disable/delete scheduled prompts. Use this when the user asks for reminders or recurring checks. add requires prompt; once tasks require duration; recurring supports interval (duration) or cron expression (cron).",
		promptSnippet:
			"Create/list/enable/disable/delete scheduled prompts. Supports recurring intervals/cron and one-time reminders (session-scoped).",
		promptGuidelines: [
			"Use this tool when user asks to remind/check back later.",
			"For recurring tasks use kind='recurring' with duration like 5m or 2h, or provide cron.",
			"For one-time reminders use kind='once' with duration like 30m or 1h.",
		],
		parameters: SchedulePromptToolParams,
		execute: async (
			_toolCallId,
			params: SchedulePromptToolParamsType,
		): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> => {
			const action = params.action;

			if (action === "list") {
				const list = runtime.getSortedTasks();
				if (list.length === 0) {
					return { content: [{ type: "text", text: "No scheduled tasks." }], details: { action, tasks: [] } };
				}

				const lines = list.map((task) => {
					const schedule =
						task.kind === "once" ? "-" : task.cronExpression ?? formatDurationShort(task.intervalMs ?? DEFAULT_LOOP_INTERVAL);
					const state = task.enabled ? "on" : "off";
					const status = task.lastStatus ?? "pending";
					const last = task.lastRunAt ? runtime.formatRelativeTime(task.lastRunAt) : "never";
					return `${task.id}\t${state}\t${task.kind}\t${schedule}\t${runtime.formatRelativeTime(task.nextRunAt)}\t${task.runCount}\t${last}\t${status}\t${task.prompt}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Scheduled tasks (id\tstate\tkind\tschedule\tnext\truns\tlast\tstatus\tprompt):\n${lines.join("\n")}`,
						},
					],
					details: { action, tasks: list },
				};
			}

			if (action === "clear") {
				const count = runtime.clearTasks();
				return {
					content: [{ type: "text", text: `Cleared ${count} scheduled task${count === 1 ? "" : "s"}.` }],
					details: { action, cleared: count },
				};
			}

			if (action === "delete") {
				const id = params.id?.trim();
				if (!id) {
					return {
						content: [{ type: "text", text: "Error: id is required for delete action." }],
						details: { action, error: "missing_id" },
					};
				}
				const removed = runtime.deleteTask(id);
				if (!removed) {
					return {
						content: [{ type: "text", text: `Task not found: ${id}` }],
						details: { action, id, removed: false },
					};
				}
				return {
					content: [{ type: "text", text: `Deleted scheduled task ${id}.` }],
					details: { action, id, removed: true },
				};
			}

			if (action === "enable" || action === "disable") {
				const id = params.id?.trim();
				if (!id) {
					return {
						content: [{ type: "text", text: `Error: id is required for ${action} action.` }],
						details: { action, error: "missing_id" },
					};
				}
				const enabled = action === "enable";
				const ok = runtime.setTaskEnabled(id, enabled);
				if (!ok) {
					return {
						content: [{ type: "text", text: `Task not found: ${id}` }],
						details: { action, id, updated: false },
					};
				}
				return {
					content: [{ type: "text", text: `${enabled ? "Enabled" : "Disabled"} scheduled task ${id}.` }],
					details: { action, id, updated: true, enabled },
				};
			}

			if (action === "add") {
				const prompt = params.prompt?.trim();
				if (!prompt) {
					return {
						content: [{ type: "text", text: "Error: prompt is required for add action." }],
						details: { action, error: "missing_prompt" },
					};
				}

				if (runtime.taskCount >= MAX_TASKS) {
					return {
						content: [{ type: "text", text: `Task limit reached (${MAX_TASKS}). Delete one first.` }],
						details: { action, error: "task_limit" },
					};
				}

				const validated = validateSchedulePromptAddInput({
					kind: params.kind,
					duration: params.duration,
					cron: params.cron,
				});
				if (!validated.ok) {
					const messageByError: Record<typeof validated.error, string> = {
						missing_duration: "Error: duration is required for one-time reminders.",
						invalid_duration: "Error: invalid duration. Use values like 5m, 2h, 1 day.",
						invalid_cron_for_once: "Error: cron is only valid for recurring tasks.",
						conflicting_schedule_inputs: "Error: provide either duration or cron for recurring tasks, not both.",
						invalid_cron: "Error: invalid cron expression.",
					};
					return {
						content: [{ type: "text", text: messageByError[validated.error] }],
						details: { action, error: validated.error },
					};
				}

				if (validated.plan.kind === "once") {
					const task = runtime.addOneShotTask(prompt, validated.plan.durationMs);
					return {
						content: [
							{
								type: "text",
								text: `Reminder scheduled (id: ${task.id}) for ${runtime.formatRelativeTime(task.nextRunAt)}.${
									validated.plan.note ? ` ${validated.plan.note}` : ""
								}`,
							},
						],
						details: { action, task },
					};
				}

				if (validated.plan.mode === "cron") {
					const task = runtime.addRecurringCronTask(prompt, validated.plan.cronExpression);
					if (!task) {
						return {
							content: [{ type: "text", text: "Error: could not compute next run for this cron expression." }],
							details: { action, error: "cron_next_run_failed" },
						};
					}
					return {
						content: [
							{
								type: "text",
								text: `Recurring cron task scheduled (id: ${task.id}) with '${task.cronExpression}'. Expires in 3 days.${
									validated.plan.note ? ` ${validated.plan.note}` : ""
								}`,
							},
						],
						details: { action, task },
					};
				}

				const task = runtime.addRecurringIntervalTask(prompt, validated.plan.durationMs);
				return {
					content: [
						{
							type: "text",
							text: `Recurring task scheduled (id: ${task.id}) every ${formatDurationShort(validated.plan.durationMs)}. Expires in 3 days.${
								validated.plan.note ? ` ${validated.plan.note}` : ""
							}`,
						},
					],
					details: { action, task },
				};
			}

			return {
				content: [{ type: "text", text: `Error: unsupported action '${String(action)}'.` }],
				details: { action, error: "unsupported_action" },
			};
		},
	});
}
