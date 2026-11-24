import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import * as schema from '../server/db/schema'

export type TestDb = PgliteDatabase<typeof schema>

const migrations = new URL('../server/db/migrations/postgresql/', import.meta.url)

/**
 * A fresh in-memory database with every migration applied, in journal order. `before` runs just ahead of
 * the named migration, to seed the data that migration has to carry over.
 */
export async function createTestDb(before?: { tag: string, seed: (client: PGlite) => Promise<unknown> }): Promise<TestDb> {
	const client = new PGlite()
	const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', migrations), 'utf8')) as { entries: { tag: string }[] }
	for (const { tag } of journal.entries) {
		if (tag === before?.tag) await before.seed(client)
		await client.exec(readFileSync(new URL(`${tag}.sql`, migrations), 'utf8'))
	}
	return drizzle(client, { schema })
}
