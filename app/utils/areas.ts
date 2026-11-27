import type { UserRole } from '#shared/types/db'

/** The parts of the app, each with its own sidebar. */
export type Area = 'chat' | 'content' | 'settings' | 'admin'

/** A page of an area, as its sidebar, the breadcrumb and the search palette list it. */
export interface Section {
	label: string
	icon: string
	to: string
	/** Lit only on this page, not on the ones under it (an area's first page, whose address is the area's). */
	exact?: boolean
	/** Starts a group in the sidebar, under this heading. */
	heading?: string
	/** Hidden from lower roles; the page itself checks too. */
	minRole?: UserRole
}

/**
 * Every area: its name, its first page, and its pages. The one list the sidebars, the breadcrumb's dropdowns and the
 * search palette read, so they cannot disagree.
 */
export const AREAS: Record<Area, { label: string, icon: string, to: string, minRole?: UserRole, sections: Section[] }> = {
	chat: { label: 'Chat', icon: 'i-lucide-message-circle', to: '/', sections: [] },
	content: {
		label: 'Content',
		icon: 'i-lucide-shapes',
		to: '/content',
		sections: [
			{ label: 'Overview', icon: 'i-lucide-layout-grid', to: '/content', exact: true },
			{ label: 'Explore', icon: 'i-lucide-telescope', to: '/content/explore' },
			{ label: 'Your stars', icon: 'i-lucide-star', to: '/content/stars' },
			{ label: 'Characters', icon: 'i-lucide-drama', to: '/content/characters', heading: 'My content' },
			{ label: 'Libraries', icon: 'i-lucide-library-big', to: '/content/libraries' },
			{ label: 'Structure profiles', icon: 'i-lucide-layers', to: '/content/structure-profiles' },
			{ label: 'Published', icon: 'i-lucide-send', to: '/content/published' },
			{ label: 'Review', icon: 'i-lucide-shield-check', to: '/admin/review', minRole: 'moderator' },
		],
	},
	settings: {
		label: 'Settings',
		icon: 'i-lucide-user-cog',
		to: '/settings',
		sections: [
			{ label: 'Usage and keys', icon: 'i-lucide-key-round', to: '/settings', exact: true },
			{ label: 'Chat', icon: 'i-lucide-message-square', to: '/settings/chat' },
			{ label: 'Model profiles', icon: 'i-lucide-bot', to: '/settings/model-profiles' },
			{ label: 'Your data', icon: 'i-lucide-hard-drive-download', to: '/settings/data' },
		],
	},
	admin: {
		label: 'Admin',
		icon: 'i-lucide-shield',
		to: '/admin/users',
		minRole: 'moderator',
		sections: [
			{ label: 'Users', icon: 'i-lucide-users', to: '/admin/users' },
			{ label: 'Explore', icon: 'i-lucide-telescope', to: '/admin/explore' },
			{ label: 'Review', icon: 'i-lucide-shield-check', to: '/admin/review' },
			{ label: 'Invites', icon: 'i-lucide-ticket', to: '/admin/invites', minRole: 'admin' },
			{ label: 'Models', icon: 'i-lucide-boxes', to: '/admin/models', minRole: 'admin' },
			{ label: 'Settings', icon: 'i-lucide-settings', to: '/admin/settings', minRole: 'admin' },
		],
	},
}

/** The area a page belongs to, by its address. The only place that decides which sidebar shows. */
export function areaOf(path: string): Area {
	for (const area of ['content', 'settings', 'admin'] as const) {
		const root = area === 'admin' ? '/admin' : AREAS[area].to
		if (isUnder(path, root)) return area
	}
	return 'chat'
}

/** Whether `path` is the page `to` or one under it, for a sidebar row that stays lit on its sub-pages. */
export const isUnder = (path: string, to: string) => path === to || path.startsWith(`${to}/`)

/** Whether a section (or an area) is for someone of `role`. */
export const allowed = (role: UserRole | undefined, minRole: UserRole | undefined) => !minRole || getRoleLevel(role) >= getRoleLevel(minRole)

/** The sections of an area someone of `role` sees. */
export const sectionsOf = (area: Area, role: UserRole | undefined) => AREAS[area].sections.filter(section => allowed(role, section.minRole))

/** The section a page is in: the one whose address is the longest that the page is under (or is, for an exact one). */
export function sectionOf(area: Area, path: string) {
	return AREAS[area].sections
		.filter(section => section.exact ? path === section.to : isUnder(path, section.to))
		.sort((a, b) => b.to.length - a.to.length)[0]
}
