import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands";
import { registerEvents } from "./events";
import { SchedulerRuntime } from "./runtime";
import { registerTools } from "./tools";

export {
	computeNextCronRunAt,
	normalizeCronExpression,
	parseLoopScheduleArgs,
	validateSchedulePromptAddInput,
} from "./scheduling";

export default function schedulerExtension(pi: ExtensionAPI) {
	const runtime = new SchedulerRuntime(pi);
	registerEvents(pi, runtime);
	registerCommands(pi, runtime);
	registerTools(pi, runtime);
}
