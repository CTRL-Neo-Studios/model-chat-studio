import { expect, test } from 'bun:test'
import * as schema from '../server/db/schema'
import { searchableText, searchEntryTexts } from '../server/utils/library/search'
import { createTestDb } from './db'

// Spike D's sample (plan section 6), now through Postgres full-text search.
const notes = [
	{ name: 'budget-2027.md', text: 'Quarterly budget. Q3 marketing spend is 40,000 USD; hiring is frozen until Q4.' },
	{ name: 'k8s-deploy.md', text: 'Kubernetes deployment guide: build the image, push it, then apply the manifests with kubectl.' },
	{ name: 'sourdough.md', text: 'Sourdough bread: feed the starter, mix flour and water, rest overnight, bake at 250 °C.' },
	{ name: 'acme-meeting.md', text: 'Meeting notes with Acme Corp: they want the dashboard delivered by March.' },
	{ name: '项目预算.md', text: '第三季度市场预算为四万美元，招聘冻结到第四季度。' },
	{ name: '部署指南.md', text: '部署步骤：构建镜像，推送镜像，然后用 kubectl 应用配置清单。' },
	{ name: '面包食谱.md', text: '酸面包：喂养酵头，混合面粉和水，静置一夜，烤箱二百五十度烘烤。' },
	{ name: '客户会议.md', text: '与 Acme 公司开会：他们希望三月交付仪表盘。' },
]

test('spike D\'s English and Chinese questions find their notes through the index; unrelated ones find nothing', async () => {
	const db = await createTestDb()
	const [owner] = await db.insert(schema.user).values({ githubId: 1, username: 'a' }).returning()
	const [library, other] = await db.insert(schema.library).values([{ ownerId: owner!.id, name: 'P' }, { ownerId: owner!.id, name: 'Q' }]).returning()
	const rows = await db.insert(schema.libraryEntry).values(notes.map(note => ({
		libraryId: library!.id, kind: 'note' as const, name: note.name, content: note.text, searchText: searchableText(note.name, note.text),
	}))).returning({ id: schema.libraryEntry.id, name: schema.libraryEntry.name })
	await db.insert(schema.libraryEntry).values({ libraryId: other!.id, kind: 'note', name: 'budget.md', content: 'budget', searchText: searchableText('budget.md', 'budget') })
	const nameOf = Object.fromEntries(rows.map(row => [row.id, row.name]))
	const top = async (question: string) => (await searchEntryTexts(db, [library!.id], question)).map(row => nameOf[row.id])

	expect((await top('How much did we budget for marketing in Q3?'))[0]).toBe('budget-2027.md')
	expect((await top('What are the deployment steps for kubernetes?'))[0]).toBe('k8s-deploy.md')
	expect((await top('I want to bake sourdough bread this weekend.'))[0]).toBe('sourdough.md')
	expect((await top('When does Acme want the dashboard?'))[0]).toBe('acme-meeting.md')
	expect((await top('第三季度的市场预算是多少？'))[0]).toBe('项目预算.md')
	expect((await top('我想做面包，有什么步骤？'))[0]).toBe('面包食谱.md')
	expect((await top('怎么部署到集群？'))[0]).toBe('部署指南.md')
	expect(await top('What is the weather like today?')).toEqual([])
	expect(await top('今天天气怎么样？')).toEqual([])
	// Stemming: "deploying" finds "deployment"'s note too.
	expect(await top('deploying')).toContain('k8s-deploy.md')
	// The excerpt shows the matching words.
	expect((await searchEntryTexts(db, [library!.id], 'sourdough'))[0]!.excerpt).toContain('<b>Sourdough</b>')
})
