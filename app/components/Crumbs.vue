<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * The trail in a page's top bar, from its address: the area (a dropdown of the areas), the area's page (a dropdown of
 * its other pages), then what is open (`current`, or the `current` slot: a chat's title, renamed in place). In chat,
 * the folders a chat or folder is in. On a narrow screen, the last two only.
 */
const props = defineProps<{ current?: string }>()
const slots = defineSlots<{ current?: () => unknown }>()

interface Segment {
	label: string
	to?: string
	/** A dropdown of where else to go from here. */
	items?: DropdownMenuItem[]
	/** Said after the label to screen readers, for a dropdown: what it lists. */
	hint?: string
}

const route = useRoute()
const { loggedIn, user } = useUserSession()
const area = computed(() => areaOf(route.path))
/** The kind of thing open in Content (a library, a Character, a structure profile), for its siblings' dropdown. */
const kind = computed(() => (['libraries', 'characters', 'structure-profiles'] as const).find(entry => route.path.startsWith(`/content/${entry}/`)))
const { data: chats } = useQuery(() => ({ ...chatsQuery, enabled: import.meta.client && loggedIn.value && area.value === 'chat' }))
const { data: folders } = useQuery(() => ({ ...foldersQuery, enabled: import.meta.client && loggedIn.value && area.value === 'chat' }))
const { data: libraries } = useQuery(() => ({ ...librariesQuery, enabled: import.meta.client && kind.value === 'libraries' }))
const { data: characters } = useQuery(() => ({ ...charactersQuery, enabled: import.meta.client && kind.value === 'characters' }))
const { data: profiles } = useQuery(() => ({ ...structureProfilesQuery, enabled: import.meta.client && kind.value === 'structure-profiles' }))
const siblings = computed<{ id: string, name: string }[] | undefined>(() => ({ 'libraries': libraries.value, 'characters': characters.value, 'structure-profiles': profiles.value, 'none': undefined })[kind.value ?? 'none'])

/** A folder and the folders it is in, outermost first, each a link to its page. */
function folderPath(folderId: string | null | undefined): Segment[] {
	const trail: Segment[] = []
	for (let folder = folders.value?.find(entry => entry.id === folderId); folder; folder = folders.value?.find(entry => entry.id === folder!.parentId)) {
		trail.unshift({ label: folder.name, to: `/folders/${folder.id}` })
	}
	return trail
}

const segments = computed<Segment[]>(() => {
	const path = route.path
	// Someone reading a chat by its link has no areas: the title alone.
	if (!loggedIn.value) return [{ label: props.current ?? '' }]
	const role = user.value?.role
	const here = AREAS[area.value]
	const trail: Segment[] = [{
		label: here.label,
		to: here.to,
		items: (Object.keys(AREAS) as Area[]).filter(key => allowed(role, AREAS[key].minRole)).map(key => ({ label: AREAS[key].label, icon: AREAS[key].icon, to: AREAS[key].to, ...here === AREAS[key] && { color: 'primary' as const } })),
		hint: 'areas',
	}]

	if (area.value === 'chat') {
		if (path === '/temporary') trail.push({ label: 'Temporary chat' })
		else if (path.startsWith('/folders/')) trail.push(...folderPath(String(route.params.id)))
		else if (path.startsWith('/chat/')) trail.push(...folderPath(chats.value?.find(chat => chat.id === route.params.id)?.folderId), { label: props.current ?? '' })
		return trail
	}

	const section = sectionOf(area.value, path)
	if (!section) return trail
	trail.push({
		label: section.label,
		to: section.to,
		items: sectionsOf(area.value, role).map(other => ({ label: other.label, icon: other.icon, to: other.to, ...other === section && { color: 'primary' as const } })),
		hint: `pages of ${here.label}`,
	})
	// A page under the section's: what is open there, with the others of its kind when the browser has them.
	if (path !== section.to) {
		const others = siblings.value?.map(item => ({ label: item.name, icon: section.icon, to: `${section.to}/${item.id}`, ...item.id === route.params.id && { color: 'primary' as const } }))
		trail.push({ label: props.current ?? '', items: others?.length ? others : undefined, hint: section.label.toLowerCase() })
	}
	return trail
})
const last = computed(() => segments.value.length - 1)
</script>

<template>
	<nav aria-label="Breadcrumb" class="min-w-0">
		<ol class="flex items-center gap-0.5 min-w-0">
			<li v-for="(segment, index) in segments" :key="index" class="flex items-center gap-0.5 min-w-0" :class="index < last - 1 && 'max-sm:hidden'">
				<UIcon v-if="index" name="i-lucide-chevron-right" class="size-4 text-dimmed shrink-0" aria-hidden="true" />
				<slot v-if="index === last && slots.current" name="current" />
				<UDropdownMenu v-else-if="segment.items?.length" :items="segment.items" :content="{ align: 'start' }">
					<UButton
						:label="segment.label"
						trailing-icon="i-lucide-chevron-down"
						color="neutral"
						variant="ghost"
						size="sm"
						:aria-label="`${segment.label}, ${segment.hint}`"
						:aria-current="index === last ? 'page' : undefined"
						class="min-w-0 data-[state=open]:bg-elevated"
						:class="index === last ? 'font-semibold text-highlighted' : 'text-muted'"
						:ui="{ label: 'truncate', trailingIcon: 'text-dimmed size-4' }"
					/>
				</UDropdownMenu>
				<ULink v-else-if="segment.to && index !== last" :to="segment.to" class="px-1.5 text-sm text-muted hover:text-highlighted truncate">
					{{ segment.label }}
				</ULink>
				<span v-else aria-current="page" class="px-1.5 text-sm font-semibold text-highlighted truncate">{{ segment.label }}</span>
			</li>
		</ol>
	</nav>
</template>
