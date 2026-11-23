import { expect, test } from 'bun:test'
import { shownThread, threadTo } from '../server/utils/chat/thread'

type Row = { id: string, role: 'user' | 'assistant' | 'system', parentId: string | null }
const user = (id: string, parentId: string | null): Row => ({ id, role: 'user', parentId })
const answer = (id: string, parentId: string): Row => ({ id, role: 'assistant', parentId })
const summary = (id: string, parentId: string): Row => ({ id, role: 'system', parentId })

// u1 → u2 → u3, a summary after u2; u2 edited into u2b (a branch at u1) → u3b. Rows in `listChatMessages` order.
const chat: Row[] = [
	user('u1', null), answer('a1', 'u1'),
	user('u2', 'u1'), answer('a2', 'u2'),
	summary('s2', 'u2'),
	user('u3', 'u2'), answer('a3', 'u3'),
	user('u2b', 'u1'), answer('a2b', 'u2b'),
	user('u3b', 'u2b'), answer('a3b', 'u3b'),
]
const ids = (rows: Row[]) => rows.map(row => row.id)

test('the branch shown is the path to the tip, with its answers and the summaries made on it', () => {
	expect(ids(shownThread(chat, 'u3'))).toEqual(['u1', 'a1', 'u2', 'a2', 's2', 'u3', 'a3'])
	// The other branch left before the summary, so it does not get it.
	expect(ids(shownThread(chat, 'u3b'))).toEqual(['u1', 'a1', 'u2b', 'a2b', 'u3b', 'a3b'])
	// A tip in the middle shows the branch up to it.
	expect(ids(shownThread(chat, 'u2'))).toEqual(['u1', 'a1', 'u2', 'a2', 's2'])
})

test('without a tip, or with one that is gone or not a user message, the newest user message is the tip', () => {
	expect(ids(shownThread(chat, null))).toEqual(ids(shownThread(chat, 'u3b')))
	expect(ids(shownThread(chat, 'gone'))).toEqual(ids(shownThread(chat, 'u3b')))
	expect(ids(shownThread(chat, 'a2'))).toEqual(ids(shownThread(chat, 'u3b')))
	expect(shownThread([], null)).toEqual([])
})

test('a model answering a message reads the path to it, without its answers or a summary made after it', () => {
	expect(ids(threadTo(chat, 'u2'))).toEqual(['u1', 'a1', 'u2'])
	expect(ids(threadTo(chat, 'u3'))).toEqual(['u1', 'a1', 'u2', 'a2', 's2', 'u3'])
	expect(ids(threadTo(chat, 'u2b'))).toEqual(['u1', 'a1', 'u2b'])
})

test('a parent chain that loops ends instead of hanging', () => {
	expect(ids(shownThread([user('x', 'y'), user('y', 'x')], 'x'))).toEqual(['x', 'y'])
})
