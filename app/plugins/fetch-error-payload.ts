// A query that failed during server rendering keeps its error (`ssrCatchError`), which travels to the browser in
// the payload. `$fetch` errors are class instances the payload cannot hold, so they travel as their fields.
export default definePayloadPlugin(() => {
	definePayloadReducer('FetchError', value => value instanceof Error && value.name === 'FetchError'
		&& { message: value.message, statusCode: 'statusCode' in value ? value.statusCode : undefined, data: 'data' in value ? value.data : undefined })
	definePayloadReviver('FetchError', ({ message, statusCode, data }) => Object.assign(new Error(message), { name: 'FetchError', statusCode, data }))
})
