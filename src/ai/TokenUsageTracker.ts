import type { AIProvider } from "./Provider";

export type TokenType = "input" | "output";

export interface ProviderUsage {
    inputTokens: number;
    outputTokens: number;
    requests: number;
    cost: number;
}

export interface UsageReportProvider extends ProviderUsage {
    id: string;
    averageTokensPerRequest: number;
}

export interface UsageReport {
    period: "all";
    providers: UsageReportProvider[];
    totalCost: number;
    totalTokens: number;
}

/**
 * Simple utility that returns cost in USD given token counts & provider info.
 * For now we only support provider-level pricing. If a model within a provider
 * has its own pricing, we encourage callers to pass a *temporary* provider
 * object with costPerToken overridden.
 */
export class CostCalculator {
    calculate(usage: ProviderUsage, provider: AIProvider): number {
        const rates = provider.costPerToken ?? { input: 0, output: 0 };
        return (
            usage.inputTokens * rates.input + usage.outputTokens * rates.output
        );
    }
}

/**
 * Singleton tracker responsible for recording token usage across providers.
 * It persists to localStorage.
 */
export class TokenUsageTracker {
    private static _instance: TokenUsageTracker;
    private readonly usage: Map<string, ProviderUsage> = new Map();
    private readonly costCalculator = new CostCalculator();

    private constructor() {
        // Load persisted usage if present
        const persistedRaw = localStorage.getItem("quickadd.ai.tokenUsage");
        const persisted = persistedRaw ? JSON.parse(persistedRaw) : undefined;
        if (persisted && typeof persisted === "object") {
            for (const providerId of Object.keys(persisted)) {
                const data = (persisted as Record<string, ProviderUsage>)[providerId];
                this.usage.set(providerId, { ...data });
            }
        }
    }

    static get instance(): TokenUsageTracker {
        if (!this._instance) this._instance = new TokenUsageTracker();
        return this._instance;
    }

    addTokens(providerId: string, count: number, type: TokenType, provider?: AIProvider) {
        const current: ProviderUsage = this.usage.get(providerId) ?? {
            inputTokens: 0,
            outputTokens: 0,
            requests: 0,
            cost: 0,
        };

        if (type === "input") current.inputTokens += count;
        else current.outputTokens += count;

        // Increment requests once per (input+output) pair. We can't know which
        // call corresponds to which, so we increment when we record input.
        if (type === "input") current.requests += 1;

        // Re-calculate cost
        if (provider) {
            current.cost = this.costCalculator.calculate(current, provider);
        }

        this.usage.set(providerId, current);
        this.saveUsage();
    }

    private saveUsage() {
        const obj: Record<string, ProviderUsage> = {};
        this.usage.forEach((v, k) => { obj[k] = v; });
        // Persist within localStorage
        try {
            localStorage.setItem("quickadd.ai.tokenUsage", JSON.stringify(obj));
        } catch (_) {
            // ignore quota or privacy errors
        }
    }

    getUsageReport(): UsageReport {
        const report: UsageReport = {
            period: "all",
            providers: [],
            totalCost: 0,
            totalTokens: 0,
        };

        for (const [id, usage] of this.usage.entries()) {
            const providerReport: UsageReportProvider = {
                id,
                ...usage,
                averageTokensPerRequest: usage.requests === 0 ? 0 : (usage.inputTokens + usage.outputTokens) / usage.requests,
            };
            report.providers.push(providerReport);
            report.totalCost += usage.cost;
            report.totalTokens += usage.inputTokens + usage.outputTokens;
        }

        return report;
    }
}