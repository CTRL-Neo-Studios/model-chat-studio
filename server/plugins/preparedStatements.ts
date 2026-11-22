import { db } from 'hub:db'
import type { Sql, TransactionSql } from 'postgres'

type Run = (...args: unknown[]) => unknown

/** Runs every query with parameters as a prepared statement. */
function prepareQueries(client: Sql | TransactionSql) {
	const unsafe = client.unsafe.bind(client) as Run
	client.unsafe = ((query: string, parameters?: unknown[], options?: object) =>
		unsafe(query, parameters, parameters?.length ? { ...options, prepare: true } : options)) as Sql['unsafe']
}

// Drizzle runs queries unprepared, so postgres-js asks the database to describe each query before running it:
// two trips per query, 0.2 to 0.3 s each to the dev database. Prepared, a query takes one trip after its first use
// on a connection. Queries without parameters (migrations, `select 1`) already take one trip and stay as they are.
// A pooler in transaction mode cannot keep statements: `hub.db.connection.prepare: false` leaves this off.
// ponytail: statements live per connection until postgres-js recycles it (30 to 60 min); a schema change under a
// running server can fail a prepared query once, so restart after migrating by hand.
export default defineNitroPlugin(() => {
	const client = db.$client
	// The local database (PGlite) has a different client and no such cost.
	if (typeof client?.unsafe !== 'function' || client.options?.prepare === false) return
	prepareQueries(client)
	// A transaction's queries run on the client `begin` hands to Drizzle.
	const begin = client.begin.bind(client) as Run
	client.begin = ((...args: unknown[]) => {
		const run = args.pop() as (transaction: TransactionSql) => unknown
		return begin(...args, (transaction: TransactionSql) => {
			prepareQueries(transaction)
			return run(transaction)
		})
	}) as Sql['begin']
})
