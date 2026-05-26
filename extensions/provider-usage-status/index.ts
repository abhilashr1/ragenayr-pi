import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type WindowKey = "5h" | "weekly";

type WindowUsage = {
	limit?: number;
	remaining?: number;
	used?: number;
	reset?: string;
};

type ProviderUsage = Partial<Record<WindowKey, WindowUsage>>;

type SpendPoint = { ts: number; usd: number };

type ProviderState = {
	usage?: ProviderUsage;
	responsesSeen: number;
	turnsSeen: number;
	tokensIn: number;
	tokensOut: number;
	spendPoints: SpendPoint[];
	lastFetchAt?: number;
	lastProbeAt?: number;
	lastError?: string;
};

const stateByProvider = new Map<string, ProviderState>();
let activeProvider = "";

const REFRESH_MS = 5 * 60 * 1000;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const OPENCODE_LIMIT_5H_USD = parseNumber(process.env.PI_OPENCODE_LIMIT_5H_USD) ?? 12;
const OPENCODE_LIMIT_WEEKLY_USD = parseNumber(process.env.PI_OPENCODE_LIMIT_WEEKLY_USD) ?? 30;
const OPENCODE_INPUT_PRICE_PER_M = parseNumber(process.env.PI_OPENCODE_INPUT_PRICE_PER_M) ?? 2.5;
const OPENCODE_OUTPUT_PRICE_PER_M = parseNumber(process.env.PI_OPENCODE_OUTPUT_PRICE_PER_M) ?? 10;

function getState(provider: string): ProviderState {
	const existing = stateByProvider.get(provider);
	if (existing) return existing;
	const created: ProviderState = { responsesSeen: 0, turnsSeen: 0, tokensIn: 0, tokensOut: 0, spendPoints: [] };
	stateByProvider.set(provider, created);
	return created;
}

function parseNumber(value: unknown): number | undefined {
	if (value === null || value === undefined) return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

function normalizeHeaders(input: unknown): Record<string, string> {
	if (!input) return {};
	if (typeof Headers !== "undefined" && input instanceof Headers) {
		const out: Record<string, string> = {};
		for (const [k, v] of input.entries()) out[k.toLowerCase()] = v;
		return out;
	}
	if (input instanceof Map) {
		const out: Record<string, string> = {};
		for (const [k, v] of input.entries()) out[String(k).toLowerCase()] = String(v);
		return out;
	}
	if (typeof input === "object") {
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k.toLowerCase()] = String(v ?? "");
		return out;
	}
	return {};
}

function findHeader(headers: Record<string, string>, pattern: RegExp): string | undefined {
	for (const [key, value] of Object.entries(headers)) {
		if (pattern.test(key)) return value;
	}
	return undefined;
}

function collectWindow(headers: Record<string, string>, key: WindowKey): WindowUsage | undefined {
	const windowPattern = key === "5h" ? "(?:5h|5-hour|5hour)" : "(?:weekly|week|7d)";
	const limit =
		parseNumber(findHeader(headers, new RegExp(`(limit|quota).*(requests|msgs|messages)?.*${windowPattern}`))) ??
		parseNumber(findHeader(headers, new RegExp(`${windowPattern}.*(limit|quota)`)));
	const remaining =
		parseNumber(findHeader(headers, new RegExp(`remaining.*(requests|msgs|messages)?.*${windowPattern}`))) ??
		parseNumber(findHeader(headers, new RegExp(`${windowPattern}.*remaining`)));
	const used =
		parseNumber(findHeader(headers, new RegExp(`used.*(requests|msgs|messages)?.*${windowPattern}`))) ??
		(limit !== undefined && remaining !== undefined ? limit - remaining : undefined);
	const reset =
		findHeader(headers, new RegExp(`reset.*${windowPattern}`)) ??
		findHeader(headers, new RegExp(`${windowPattern}.*reset`));

	if (limit === undefined && remaining === undefined && used === undefined && !reset) return undefined;
	return { limit, remaining, used, reset };
}

function collectCodexWindows(headers: Record<string, string>): ProviderUsage | undefined {
	const primaryMinutes = parseNumber(headers["x-codex-primary-window-minutes"]);
	const secondaryMinutes = parseNumber(headers["x-codex-secondary-window-minutes"]);
	const primaryUsedPct = parseNumber(headers["x-codex-primary-used-percent"]);
	const secondaryUsedPct = parseNumber(headers["x-codex-secondary-used-percent"]);
	const primaryResetAt = headers["x-codex-primary-reset-at"];
	const secondaryResetAt = headers["x-codex-secondary-reset-at"];

	const out: ProviderUsage = {};
	if (primaryMinutes === 300 && primaryUsedPct !== undefined) {
		out["5h"] = { limit: 100, used: primaryUsedPct, remaining: 100 - primaryUsedPct, reset: primaryResetAt };
	}
	if (secondaryMinutes === 10080 && secondaryUsedPct !== undefined) {
		out.weekly = { limit: 100, used: secondaryUsedPct, remaining: 100 - secondaryUsedPct, reset: secondaryResetAt };
	}
	return out["5h"] || out.weekly ? out : undefined;
}

function compactWindow(label: string, data: WindowUsage): string {
	if (data.limit === 100 && data.used !== undefined) return `${label} ${Math.round(data.used)}%`;
	if (data.used !== undefined && data.limit !== undefined) return `${label} ${data.used.toFixed(2)}/${data.limit.toFixed(2)}`;
	if (data.remaining !== undefined && data.limit !== undefined) return `${label} ${(data.limit - data.remaining).toFixed(2)}/${data.limit.toFixed(2)}`;
	if (data.remaining !== undefined) return `${label} rem:${data.remaining.toFixed(2)}`;
	if (data.limit !== undefined) return `${label} lim:${data.limit.toFixed(2)}`;
	if (data.reset) return `${label} reset:${data.reset}`;
	return `${label} ?`;
}

function pruneSpendPoints(state: ProviderState): void {
	const minTs = Date.now() - WEEK_MS;
	state.spendPoints = state.spendPoints.filter((p) => p.ts >= minTs);
}

function sumSpendSince(state: ProviderState, sinceTs: number): number {
	let sum = 0;
	for (const p of state.spendPoints) if (p.ts >= sinceTs) sum += p.usd;
	return sum;
}

function estimateTurnCost(tokensIn: number, tokensOut: number): number {
	return (tokensIn / 1_000_000) * OPENCODE_INPUT_PRICE_PER_M + (tokensOut / 1_000_000) * OPENCODE_OUTPUT_PRICE_PER_M;
}

function buildOpenCodeEstimatedUsage(state: ProviderState): ProviderUsage {
	pruneSpendPoints(state);
	const now = Date.now();
	const spent5h = sumSpendSince(state, now - FIVE_HOURS_MS);
	const spentWk = sumSpendSince(state, now - WEEK_MS);

	return {
		"5h": { limit: OPENCODE_LIMIT_5H_USD, used: spent5h, remaining: Math.max(0, OPENCODE_LIMIT_5H_USD - spent5h) },
		weekly: { limit: OPENCODE_LIMIT_WEEKLY_USD, used: spentWk, remaining: Math.max(0, OPENCODE_LIMIT_WEEKLY_USD - spentWk) },
	};
}

function extractUsageFromJson(payload: unknown): ProviderUsage | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const obj = payload as Record<string, unknown>;
	const windows = (obj.windows && typeof obj.windows === "object" ? obj.windows : obj) as Record<string, unknown>;

	function pickWindow(raw: unknown): WindowUsage | undefined {
		if (!raw || typeof raw !== "object") return undefined;
		const r = raw as Record<string, unknown>;
		const limit = parseNumber(r.limit);
		const remaining = parseNumber(r.remaining);
		const used = parseNumber(r.used) ?? (limit !== undefined && remaining !== undefined ? limit - remaining : undefined);
		const reset = typeof r.reset === "string" ? r.reset : typeof r.resetAt === "string" ? r.resetAt : undefined;
		if (limit === undefined && remaining === undefined && used === undefined && !reset) return undefined;
		return { limit, remaining, used, reset };
	}

	const fiveHour = pickWindow(windows["5h"] ?? windows.fiveHour ?? windows.five_hour);
	const weekly = pickWindow(windows.weekly ?? windows.week ?? windows["7d"]);
	if (!fiveHour && !weekly) return undefined;
	return { ...(fiveHour ? { "5h": fiveHour } : {}), ...(weekly ? { weekly } : {}) };
}

function isCursorProvider(provider: string): boolean {
	return provider.toLowerCase().includes("cursor");
}

function getUsageEndpoint(provider: string): string | undefined {
	const p = provider.toLowerCase();
	if (p.includes("openai")) return process.env.PI_USAGE_ENDPOINT_OPENAI;
	if (p.includes("opencode") || p.includes("go")) return process.env.PI_USAGE_ENDPOINT_OPENCODE;
	if (p.includes("cursor")) return process.env.PI_USAGE_ENDPOINT_CURSOR;
	return undefined;
}

function getUsageToken(provider: string): string | undefined {
	const p = provider.toLowerCase();
	if (p.includes("openai")) return process.env.PI_USAGE_TOKEN_OPENAI ?? process.env.OPENAI_API_KEY;
	if (p.includes("opencode") || p.includes("go")) return process.env.PI_USAGE_TOKEN_OPENCODE;
	if (p.includes("cursor")) return process.env.PI_USAGE_TOKEN_CURSOR;
	return undefined;
}

function resolveCodexUrl(baseUrl: string | undefined): string {
	const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : "https://chatgpt.com/backend-api";
	const normalized = raw.replace(/\/+$/, "");
	if (normalized.endsWith("/codex/responses")) return normalized;
	if (normalized.endsWith("/codex")) return `${normalized}/responses`;
	return `${normalized}/codex/responses`;
}

async function probeCodexLimits(provider: string, ctx: ExtensionContext): Promise<void> {
	if (!provider.toLowerCase().includes("openai-codex")) return;
	const model = ctx.model;
	if (!model || model.provider !== provider) return;

	const state = getState(provider);
	const now = Date.now();
	if (state.lastProbeAt && now - state.lastProbeAt < REFRESH_MS) return;
	state.lastProbeAt = now;

	try {
		const apiKey = (await ctx.modelRegistry.getApiKeyForProvider(provider)) ?? getUsageToken(provider);
		if (!apiKey) return;

		const res = await fetch(resolveCodexUrl(model.baseUrl), {
			method: "POST",
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: model.id,
				store: false,
				stream: true,
				instructions: "You are helpful.",
				input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
				text: { verbosity: "low" },
			}),
			signal: ctx.signal,
		});

		const headers = normalizeHeaders(res.headers);
		const codexWindows = collectCodexWindows(headers);
		if (codexWindows) {
			state.usage = { ...(state.usage ?? {}), ...codexWindows };
			state.lastError = undefined;
		}
		try {
			await res.body?.cancel();
		} catch {
			// ignore
		}
	} catch (error) {
		state.lastError = error instanceof Error ? error.message : String(error);
	}
}

async function refreshFromProviderUsageApi(provider: string, ctx: ExtensionContext): Promise<void> {
	const state = getState(provider);
	const endpoint = getUsageEndpoint(provider);
	if (!endpoint) return;
	const now = Date.now();
	if (state.lastFetchAt && now - state.lastFetchAt < REFRESH_MS) return;

	state.lastFetchAt = now;
	try {
		const token = getUsageToken(provider);
		const res = await fetch(endpoint, {
			method: "GET",
			headers: {
				"content-type": "application/json",
				...(token ? { authorization: `Bearer ${token}` } : {}),
			},
			signal: ctx.signal,
		});
		if (!res.ok) {
			state.lastError = `usage api ${res.status}`;
			return;
		}
		const body = (await res.json()) as unknown;
		const usage = extractUsageFromJson(body);
		if (!usage) {
			state.lastError = "usage api missing 5h/weekly fields";
			return;
		}
		state.usage = { ...(state.usage ?? {}), ...usage };
		state.lastError = undefined;
	} catch (error) {
		state.lastError = error instanceof Error ? error.message : String(error);
	}
}

function renderStatus(ctx: ExtensionContext): void {
	const model = ctx.model;
	if (model?.provider) activeProvider = model.provider;
	const provider = activeProvider;
	if (!provider) {
		ctx.ui.setStatus("provider-usage", ctx.ui.theme.fg("dim", "limits: no model"));
		return;
	}

	const state = getState(provider);
	const providerLower = provider.toLowerCase();
	const estimatedOpenCode = providerLower.includes("opencode-go") ? buildOpenCodeEstimatedUsage(state) : undefined;
	const usage = state.usage ?? estimatedOpenCode;

	if (!usage) {
		if (isCursorProvider(provider)) {
			// Cursor Agent SDK currently does not expose a reliable quota/limit window.
			// Avoid showing a noisy "limits unavailable" status for Cursor models.
			ctx.ui.setStatus("provider-usage", undefined);
		} else if (state.turnsSeen > 0) {
			const suffix = state.lastError ? ` (${state.lastError})` : "";
			ctx.ui.setStatus("provider-usage", ctx.ui.theme.fg("dim", `${provider} limits: unavailable (${state.turnsSeen} turns, no provider headers${suffix})`));
		} else {
			ctx.ui.setStatus("provider-usage", ctx.ui.theme.fg("dim", `${provider} limits: waiting for response...`));
		}
		return;
	}

	const chunks: string[] = [];
	if (usage["5h"]) chunks.push(compactWindow("5h", usage["5h"]!));
	if (usage.weekly) chunks.push(compactWindow("wk", usage.weekly));

	const isEstimatedOpenCode = providerLower.includes("opencode-go") && !state.usage;
	const prefix = isEstimatedOpenCode ? `${provider} est` : provider;
	if (chunks.length === 0 && isCursorProvider(provider)) {
		ctx.ui.setStatus("provider-usage", undefined);
		return;
	}

	const text = chunks.length > 0 ? `${prefix} ${chunks.join(" • ")}` : `${provider} limits: unavailable`;
	ctx.ui.setStatus("provider-usage", ctx.ui.theme.fg("dim", text));
}

export default function providerUsageStatus(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.model?.provider) activeProvider = ctx.model.provider;
		const provider = activeProvider;
		if (provider) {
			// Rebuild spend from session entries so it survives reload
			const state = getState(provider);
			for (const entry of ctx.sessionManager.getBranch()) {
				if (entry.type === "message" && entry.message.role === "assistant") {
					const usage = (entry.message as { usage?: { input?: number; output?: number; cost?: { total?: number } } }).usage;
					if (usage) {
						state.tokensIn += Number(usage.input ?? 0);
						state.tokensOut += Number(usage.output ?? 0);
						let usd = Number(usage.cost?.total ?? 0);
						if (!Number.isFinite(usd) || usd <= 0) {
							usd = estimateTurnCost(Number(usage.input ?? 0), Number(usage.output ?? 0));
						}
						if (Number.isFinite(usd) && usd > 0) {
							const ts = typeof entry.message.timestamp === "number" ? entry.message.timestamp : Date.now();
							state.spendPoints.push({ ts, usd });
						}
					}
				}
			}
			await refreshFromProviderUsageApi(provider, ctx);
			await probeCodexLimits(provider, ctx);
		}
		renderStatus(ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		activeProvider = event.model.provider;
		await refreshFromProviderUsageApi(activeProvider, ctx);
		await probeCodexLimits(activeProvider, ctx);
		renderStatus(ctx);
	});

	pi.on("turn_end", async (event, ctx) => {
		const provider = ctx.model?.provider || activeProvider;
		if (!provider) return;
		const state = getState(provider);
		state.turnsSeen += 1;

		const msg = event.message as { usage?: { input?: number; output?: number; cost?: { total?: number } } };
		state.tokensIn += Number(msg?.usage?.input ?? 0);
		state.tokensOut += Number(msg?.usage?.output ?? 0);
		let usd = Number(msg?.usage?.cost?.total ?? 0);
		if (!Number.isFinite(usd) || usd <= 0) {
			usd = estimateTurnCost(Number(msg?.usage?.input ?? 0), Number(msg?.usage?.output ?? 0));
		}
		if (Number.isFinite(usd) && usd > 0) state.spendPoints.push({ ts: Date.now(), usd });

		await refreshFromProviderUsageApi(provider, ctx);
		if (!state.usage?.["5h"] || !state.usage?.weekly) await probeCodexLimits(provider, ctx);
		renderStatus(ctx);
	});

	pi.on("after_provider_response", async (event, ctx) => {
		const provider = ctx.model?.provider || activeProvider;
		if (!provider) return;
		activeProvider = provider;
		const state = getState(provider);
		state.responsesSeen += 1;

		const headers = normalizeHeaders(event.headers);
		const existing = state.usage ?? {};
		const fiveHour = collectWindow(headers, "5h");
		const weekly = collectWindow(headers, "weekly");
		const codexWindows = collectCodexWindows(headers);

		if (fiveHour) existing["5h"] = fiveHour;
		if (weekly) existing.weekly = weekly;
		if (codexWindows?.["5h"]) existing["5h"] = codexWindows["5h"];
		if (codexWindows?.weekly) existing.weekly = codexWindows.weekly;

		if (!existing["5h"] && provider.toLowerCase().includes("openai")) {
			const limit = parseNumber(headers["x-ratelimit-limit-requests"]);
			const remaining = parseNumber(headers["x-ratelimit-remaining-requests"]);
			if (limit !== undefined || remaining !== undefined) {
				existing["5h"] = { limit, remaining, used: limit !== undefined && remaining !== undefined ? limit - remaining : undefined };
			}
		}

		if (Object.keys(existing).length > 0) state.usage = existing;
		if (!state.usage?.["5h"] || !state.usage?.weekly) {
			await refreshFromProviderUsageApi(provider, ctx);
			await probeCodexLimits(provider, ctx);
		}
		renderStatus(ctx);
	});
}
