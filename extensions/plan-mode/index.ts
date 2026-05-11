import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
	Container,
	Key,
	type SelectItem,
	SelectList,
	Text,
} from "@mariozechner/pi-tui";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.js";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	// Model selections for plan/impl modes (provider + id)
	let planModelProvider: string | null = null;
	let planModelId: string | null = null;
	let implModelProvider: string | null = null;
	let implModelId: string | null = null;
	// Original model to restore on plan-mode exit
	let originalModelProvider: string | null = null;
	let originalModelId: string | null = null;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			const modelLabel = planModelId ? ` ⏸ plan (${planModelId})` : " ⏸ plan";
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", modelLabel));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			planModelProvider,
			planModelId,
			implModelProvider,
			implModelId,
			originalModelProvider,
			originalModelId,
		});
	}

	/**
	 * Show a SelectList popup for model selection.
	 * Returns the selected model as { provider, id } or null if cancelled.
	 */
	async function showModelSelector(
		ctx: ExtensionContext,
		title: string,
	): Promise<{ provider: string; id: string } | null> {
		const available = ctx.modelRegistry.getAvailable();
		if (available.length === 0) {
			ctx.ui.notify("No available models configured.", "warning");
			return null;
		}

		const items: SelectItem[] = available.map((m) => ({
			value: `${m.provider}/${m.id}`,
			label: m.name ?? m.id,
			description: `${m.provider}/${m.id}`,
		}));

		const result = await ctx.ui.custom<{ provider: string; id: string } | null>(
			(tui, theme, _kb, done) => {
				const container = new Container();

				// Top border
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				// Title
				container.addChild(
					new Text(theme.fg("accent", theme.bold(title)), 1, 0),
				);

				// SelectList
				const selectList = new SelectList(items, Math.min(items.length, 12), {
					selectedPrefix: (t) => theme.fg("accent", t),
					selectedText: (t) => theme.fg("accent", t),
					description: (t) => theme.fg("muted", t),
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				});
				selectList.onSelect = (item) => {
					const [provider, ...idParts] = item.value.split("/");
					done({ provider: provider!, id: idParts.join("/") });
				};
				selectList.onCancel = () => done(null);
				container.addChild(selectList);

				// Help text
				container.addChild(
					new Text(theme.fg("dim", "↑↓ navigate  •  enter select  •  esc cancel"), 1, 0),
				);

				// Bottom border
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				return {
					render: (w: number) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						selectList.handleInput(data);
						tui.requestRender();
					},
				};
			},
		);

		return result;
	}

	async function togglePlanMode(ctx: ExtensionContext): Promise<void> {
		if (!planModeEnabled) {
			// --- Enabling plan mode: ask for model selections first ---

			// Save original model for restore on exit
			if (ctx.model) {
				originalModelProvider = ctx.model.provider;
				originalModelId = ctx.model.id;
			}

			// Step 1: Pick planning model
			const planModel = await showModelSelector(ctx, "Select model for PLANNING");
			if (!planModel) {
				ctx.ui.notify("Plan mode cancelled.", "info");
				return;
			}
			planModelProvider = planModel.provider;
			planModelId = planModel.id;

			// Step 2: Pick implementation model
			const implModel = await showModelSelector(ctx, "Select model for IMPLEMENTATION");
			if (!implModel) {
				ctx.ui.notify("Plan mode cancelled.", "info");
				return;
			}
			implModelProvider = implModel.provider;
			implModelId = implModel.id;

			// Switch to planning model
			const planModelObj = ctx.modelRegistry.find(planModelProvider, planModelId);
			if (planModelObj) {
				await pi.setModel(planModelObj);
				ctx.ui.notify(`Planning model: ${planModelProvider}/${planModelId}`, "info");
			}

			// Enable plan mode
			planModeEnabled = true;
			executionMode = false;
			todoItems = [];
			pi.setActiveTools(PLAN_MODE_TOOLS);
			ctx.ui.notify("Plan mode enabled.");
		} else {
			// --- Disabling plan mode: restore original model ---
			planModeEnabled = false;
			executionMode = false;
			todoItems = [];
			pi.setActiveTools(NORMAL_MODE_TOOLS);

			// Restore original model
			if (originalModelProvider && originalModelId) {
				const originalModel = ctx.modelRegistry.find(originalModelProvider, originalModelId);
				if (originalModel) {
					await pi.setModel(originalModel);
				}
			}
			ctx.ui.notify("Plan mode disabled.");
		}
		updateStatus(ctx);
		persistState();
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;
		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return { block: true, reason: `Plan mode blocked command: ${command}` };
		}
	});

	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in read-only planning mode.

Goal: inspect code and produce a complete planning summary plus actionable implementation chunks.

Output format (use these exact sections, in order):
## Problem Description
- Concise restatement of the user request and constraints.

## Observations
- Key findings from the codebase and behavior.

## Proposed Solution and Changes
- What will be changed, why, and where (files/components).
- Mention risks, assumptions, and validation approach.

## Task Breakdown
1. [file/path] exact tiny change + success check
2. [file/path] exact tiny change + success check
...

Rules:
- The first three sections must be substantive, not placeholders.
- "Task Breakdown" must be the final section.
- Prefer chunks that can be implemented in <=10 minutes.
- Keep each step to one focused edit target.
- Include acceptance check per step.
- No code changes in this mode.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed).map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN]\n${remaining}\n\nExecution rules:\n- First, identify which remaining tasks can be done in parallel vs sequentially.\n- If 2+ tasks are independent, run them in parallel using sub-agents.\n- Use sub-agents for isolated task chunks whenever useful.\n- Then merge and verify results.\n- Mark each done step with [DONE:n].`,
					display: false,
				},
			};
		}
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0 || !isAssistantMessage(event.message)) return;
		if (markCompletedSteps(getTextContent(event.message), todoItems) > 0) {
			updateStatus(ctx);
			persistState();
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		if (executionMode || !planModeEnabled || !ctx.hasUI) return;
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) todoItems = extractTodoItems(getTextContent(lastAssistant));

		if (todoItems.length > 0) {
			const choice = await ctx.ui.select("Plan ready. Next?", ["Execute the plan", "Stay in plan mode", "Refine the plan"]);
			if (choice === "Execute the plan") {
				planModeEnabled = false;
				executionMode = true;
				pi.setActiveTools(NORMAL_MODE_TOOLS);

				// Switch to implementation model
				if (implModelProvider && implModelId) {
					const implModel = ctx.modelRegistry.find(implModelProvider, implModelId);
					if (implModel) {
						await pi.setModel(implModel);
						ctx.ui.notify(`Implementation model: ${implModelProvider}/${implModelId}`, "info");
					}
				}

				updateStatus(ctx);
				persistState();
				pi.sendMessage(
					{
						customType: "plan-mode-execute",
						content:
							"Start execution: first classify remaining tasks into parallelizable vs sequential. Run independent tasks with sub-agents in parallel where possible, then continue remaining steps.",
						display: true,
					},
					{ triggerTurn: true },
				);
			}
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) planModeEnabled = true;
		const entries = ctx.sessionManager.getEntries();
		const state = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as {
				data?: {
					enabled: boolean;
					todos?: TodoItem[];
					executing?: boolean;
					planModelProvider?: string | null;
					planModelId?: string | null;
					implModelProvider?: string | null;
					implModelId?: string | null;
					originalModelProvider?: string | null;
					originalModelId?: string | null;
				};
			} | undefined;

		if (state?.data) {
			planModeEnabled = state.data.enabled ?? planModeEnabled;
			todoItems = state.data.todos ?? todoItems;
			executionMode = state.data.executing ?? executionMode;
			planModelProvider = state.data.planModelProvider ?? planModelProvider;
			planModelId = state.data.planModelId ?? planModelId;
			implModelProvider = state.data.implModelProvider ?? implModelProvider;
			implModelId = state.data.implModelId ?? implModelId;
			originalModelProvider = state.data.originalModelProvider ?? originalModelProvider;
			originalModelId = state.data.originalModelId ?? originalModelId;
		}

		if (planModeEnabled) pi.setActiveTools(PLAN_MODE_TOOLS);
		updateStatus(ctx);
	});
}
