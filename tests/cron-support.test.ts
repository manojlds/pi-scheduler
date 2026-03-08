import test from "node:test";
import assert from "node:assert/strict";
import { computeNextCronRunAt, normalizeCronExpression } from "../index.ts";

test("normalizeCronExpression normalizes 5-field cron to 6-field", () => {
	const normalized = normalizeCronExpression("*/5 * * * *");
	assert.ok(normalized);
	assert.equal(normalized.expression, "0 */5 * * * *");
	assert.ok(normalized.note?.includes("5-field cron"));
});

test("normalizeCronExpression accepts 6-field cron as-is", () => {
	const normalized = normalizeCronExpression("0 */10 * * * *");
	assert.ok(normalized);
	assert.equal(normalized.expression, "0 */10 * * * *");
	assert.equal(normalized.note, undefined);
});

test("normalizeCronExpression rejects invalid cron", () => {
	const normalized = normalizeCronExpression("not-a-cron");
	assert.equal(normalized, undefined);
});

test("computeNextCronRunAt returns a future timestamp", () => {
	const now = Date.now();
	const next = computeNextCronRunAt("0 */5 * * * *", now);
	assert.ok(next);
	assert.ok(next > now);
});
