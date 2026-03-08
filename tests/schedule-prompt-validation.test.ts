import test from "node:test";
import assert from "node:assert/strict";
import { validateSchedulePromptAddInput } from "../index.ts";

test("validateSchedulePromptAddInput rejects cron for once tasks", () => {
	const result = validateSchedulePromptAddInput({ kind: "once", cron: "*/5 * * * *" });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error, "invalid_cron_for_once");
});

test("validateSchedulePromptAddInput rejects recurring add when both duration and cron are provided", () => {
	const result = validateSchedulePromptAddInput({ kind: "recurring", duration: "5m", cron: "*/5 * * * *" });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error, "conflicting_schedule_inputs");
});

test("validateSchedulePromptAddInput validates and normalizes recurring cron", () => {
	const result = validateSchedulePromptAddInput({ kind: "recurring", cron: "*/5 * * * *" });
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.plan.kind, "recurring");
		assert.equal(result.plan.mode, "cron");
		if (result.plan.mode === "cron") {
			assert.equal(result.plan.cronExpression, "0 */5 * * * *");
		}
	}
});

test("validateSchedulePromptAddInput rejects invalid duration", () => {
	const result = validateSchedulePromptAddInput({ kind: "recurring", duration: "banana" });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error, "invalid_duration");
});

test("validateSchedulePromptAddInput requires duration for once tasks", () => {
	const result = validateSchedulePromptAddInput({ kind: "once" });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error, "missing_duration");
});

test("validateSchedulePromptAddInput defaults recurring to 10m interval", () => {
	const result = validateSchedulePromptAddInput({});
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.plan.kind, "recurring");
		assert.equal(result.plan.mode, "interval");
		if (result.plan.mode === "interval") {
			assert.equal(result.plan.durationMs, 10 * 60 * 1000);
		}
	}
});
