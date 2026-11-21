const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const smallUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 })

/** `$1.20`; amounts under a cent keep two significant digits, e.g. `$0.00012`. */
export function formatUsd(value: number): string {
	return (value > 0 && value < 0.01 ? smallUsd : usd).format(value)
}

/** `1M`, `128K`, `8,192`. */
export function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`
	if (value >= 10_000) return `${Math.round(value / 1000)}K`
	return value.toLocaleString('en-US')
}
