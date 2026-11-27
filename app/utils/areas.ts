/** The parts of the app, each with its own sidebar. */
export type Area = 'chat' | 'content'

/** The area a page belongs to, by its address. The only place that decides what the sidebar shows. */
export const areaOf = (path: string): Area => path === '/content' || path.startsWith('/content/') ? 'content' : 'chat'

/** Whether `path` is the page `to` or one under it, for a sidebar row that stays lit on its sub-pages. */
export const isUnder = (path: string, to: string) => path === to || path.startsWith(`${to}/`)
