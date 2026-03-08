import test from "node:test";
import assert from "node:assert/strict";
import { parseLoopScheduleArgs } from "../index.ts";

test("parseLoopScheduleArgs parses explicit cron with 5-field expression", () => {
	const parsed = parseLoopScheduleArgs("cron */5 * * * * check ci status");
	assert.ok(parsed);
	assert.equal(parsed.prompt, "check ci status");
	assert.equal(parsed.recurring.mode, "cron");
	if (parsed.recurring.mode === "cron") {
		assert.equal(parsed.recurring.cronExpression, "0 */5 * * * *");
	}
});

test("parseLoopScheduleArgs parses explicit cron with quoted 6-field expression", () => {
	const parsed = parseLoopScheduleArgs("cron '0 */10 * * * *' check deployment");
	assert.ok(parsed);
	assert.equal(parsed.prompt, "check deployment");
	assert.equal(parsed.recurring.mode, "cron");
	if (parsed.recurring.mode === "cron") {
		assert.equal(parsed.recurring.cronExpression, "0 */10 * * * *");
	}
});

test("parseLoopScheduleArgs returns undefined for invalid explicit cron syntax", () => {
	const parsed = parseLoopScheduleArgs("cron nope check deployment");
	assert.equal(parsed, undefined);
});

test("parseLoopScheduleArgs preserves interval parsing", () => {
	const parsed = parseLoopScheduleArgs("check build every 2h");
	assert.ok(parsed);
	assert.equal(parsed.prompt, "check build");
	assert.equal(parsed.recurring.mode, "interval");
	if (parsed.recurring.mode === "interval") {
		assert.equal(parsed.recurring.durationMs, 2 * 60 * 60 * 1000);
	}
});

test("parseLoopScheduleArgs defaults to 10m interval", () => {
	const parsed = parseLoopScheduleArgs("check build status");
	assert.ok(parsed);
	assert.equal(parsed.prompt, "check build status");
	assert.equal(parsed.recurring.mode, "interval");
	if (parsed.recurring.mode === "interval") {
		assert.equal(parsed.recurring.durationMs, 10 * 60 * 1000);
	}
});
