import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SchedulerRuntime } from "./runtime";

export function registerEvents(pi: ExtensionAPI, runtime: SchedulerRuntime) {
	pi.on("session_start", async (_event, ctx) => {
		runtime.setRuntimeContext(ctx);
		runtime.startScheduler();
		runtime.updateStatus();
	});

	pi.on("session_switch", async (_event, ctx) => {
		runtime.setRuntimeContext(ctx);
		runtime.updateStatus();
	});

	pi.on("session_fork", async (_event, ctx) => {
		runtime.setRuntimeContext(ctx);
		runtime.updateStatus();
	});

	pi.on("session_tree", async (_event, ctx) => {
		runtime.setRuntimeContext(ctx);
		runtime.updateStatus();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		runtime.setRuntimeContext(ctx);
		runtime.stopScheduler();
		runtime.clearStatus(ctx);
	});
}
