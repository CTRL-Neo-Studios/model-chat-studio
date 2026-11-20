import type { FinishedStep, TurnUsage } from './types'

/** Token totals over every step of a turn. */
export function sumTokens(steps: FinishedStep[]): Pick<TurnUsage, 'inputTokens' | 'cachedInputTokens' | 'outputTokens' | 'reasoningTokens'> {
	let inputTokens = 0, cachedInputTokens = 0, outputTokens = 0, reasoningTokens = 0
	for (const { usage } of steps) {
		inputTokens += usage.inputTokens ?? 0
		cachedInputTokens += usage.inputTokenDetails?.cacheReadTokens ?? 0
		outputTokens += usage.outputTokens ?? 0
		reasoningTokens += usage.outputTokenDetails?.reasoningTokens ?? 0
	}
	return { inputTokens, cachedInputTokens, outputTokens, reasoningTokens }
}
