<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'

const route = useRoute()
const listingId = route.params.id as string
// Rendered by the server with its data, as members open it from links; the API decides what the visitor may see.
const { data: page, error, refetch } = useQuery({ ...exploreListingQuery(listingId), enabled: true })
useHead({ title: () => page.value?.listing.name ?? 'Explore' })

const { user } = useUserSession()
const act = useApiAction()
const toast = useToast()
const queryCache = useQueryCache()
const { addToLists } = useStarLists()

const content = computed(() => page.value?.version?.content)
const fileUrl = (key: string | null) => key && page.value?.fileIds[key] ? `/api/v1/files/${page.value.fileIds[key]}` : undefined
const character = (key: string | null | undefined) => content.value?.characters.find(entry => entry.key === key)
const libraryName = (key: string) => content.value?.libraries.find(entry => entry.key === key)?.name
const profileName = (key: string | null) => content.value?.structureProfiles.find(entry => entry.key === key)?.name
const avatar = computed(() => fileUrl(content.value?.characters[0]?.avatarKey ?? null))
const mine = computed(() => page.value?.listing.ownerId === user.value?.id)

/** A library's entries in tree order with their depth, for an indented list. */
function tree(entries: NonNullable<typeof content.value>['libraries'][number]['entries']) {
	const depth: Record<string, number> = {}
	return entries.map((entry) => {
		depth[entry.key] = entry.parentKey ? (depth[entry.parentKey] ?? 0) + 1 : 0
		return { ...entry, depth: depth[entry.key]! }
	})
}

const getting = ref(false)
async function get() {
	getting.value = true
	const made = await act<{ characterIds: string[], libraryIds: string[], structureProfileIds: string[], folderId: string | null, version: number }>(`/api/v1/explore/listings/${listingId}/get`, { method: 'POST' })
	getting.value = false
	if (!made) return
	const counts = [
		made.characterIds.length && `${made.characterIds.length} ${made.characterIds.length === 1 ? 'Character' : 'Characters'}`,
		made.libraryIds.length && `${made.libraryIds.length} ${made.libraryIds.length === 1 ? 'library' : 'libraries'}`,
		made.structureProfileIds.length && `${made.structureProfileIds.length} ${made.structureProfileIds.length === 1 ? 'structure profile' : 'structure profiles'}`,
		made.folderId && 'a folder with its setup',
	].filter(Boolean)
	const open = made.folderId
		? { label: 'Open the folder', to: `/folders/${made.folderId}` }
		: made.characterIds.length
			? { label: 'Characters', to: '/characters' }
			: made.libraryIds.length
				? { label: 'Open the library', to: `/libraries/${made.libraryIds[0]}` }
				: { label: 'Structure profiles', to: '/structure-profiles' }
	toast.add({ title: `Got ${page.value?.listing.name}`, description: `Made your own copies: ${counts.join(', ')}.`, icon: 'i-lucide-download', color: 'success', actions: [open] })
	await Promise.all([
		refetch(),
		...[charactersQuery.key, librariesQuery.key, structureProfilesQuery.key, foldersQuery.key].map(key => queryCache.invalidateQueries({ key })),
	])
}
</script>

<template>
	<UDashboardPanel id="explore-listing" class="min-h-0">
		<template #header>
			<UDashboardNavbar :title="page?.listing.name ?? ''">
				<template #leading>
					<UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/explore" aria-label="Explore" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<UError v-if="error" :error="{ statusMessage: 'Listing not found', statusCode: 404 }" class="min-h-full" />
			<div v-else-if="page && content" class="w-full max-w-3xl mx-auto flex flex-col gap-6">
				<!-- What it is, who published it, and Get. -->
				<div class="flex flex-wrap items-start gap-4">
					<UAvatar v-if="avatar" :src="avatar" :alt="page.listing.name" size="3xl" />
					<div v-else class="size-16 rounded-full bg-elevated flex items-center justify-center shrink-0">
						<UIcon :name="LISTING_KINDS[page.listing.kind].icon" class="size-7 text-muted" />
					</div>
					<div class="flex-1 min-w-0 flex flex-col gap-1">
						<h1 class="text-xl font-semibold text-highlighted">
							{{ page.listing.name }}
						</h1>
						<p v-if="page.listing.summary" class="text-muted">
							{{ page.listing.summary }}
						</p>
						<p class="text-xs text-dimmed">
							{{ LISTING_KINDS[page.listing.kind].label }} by {{ page.publisher.name || page.publisher.username }}
							· version {{ page.version!.number }}, {{ formatDistanceToNow(new Date(page.version!.createdAt), { addSuffix: true }) }}
							· got by {{ page.listing.gets }}<template v-if="page.listing.category">
								· {{ page.listing.category }}
							</template>
						</p>
						<div v-if="page.listing.tags.length" class="flex flex-wrap gap-1 mt-1">
							<UButton v-for="tag in page.listing.tags" :key="tag" :label="`#${tag}`" size="xs" color="neutral" variant="soft" :to="{ path: '/explore', query: { tag } }" />
						</div>
					</div>
					<div class="flex flex-col items-end gap-1">
						<div class="flex items-center gap-1">
							<StarButton :listing-id="page.listing.id" :starred="page.starred" :stars="page.listing.stars" size="sm" />
							<UButton label="Add to a list…" icon="i-lucide-list-plus" size="sm" color="neutral" variant="ghost" @click="addToLists(page.listing.id, page.listing.name)" />
						</div>
						<UButton v-if="page.got === null" label="Get" icon="i-lucide-download" :loading="getting" @click="get" />
						<template v-else>
							<UBadge label="You have this" icon="i-lucide-check" color="success" variant="subtle" />
							<UButton v-if="page.got < page.version!.number" label="Get the new version" icon="i-lucide-download" size="sm" :loading="getting" @click="get" />
						</template>
						<UButton v-if="mine" label="Your listings" size="xs" color="neutral" variant="link" to="/explore/mine" />
					</div>
				</div>
				<UAlert v-if="page.got !== null && page.got < page.version!.number" color="info" variant="subtle" icon="i-lucide-sparkles" :title="`Version ${page.version!.number} is out; you have version ${page.got || 'an earlier one'}.`" description="Getting it makes new copies; the ones you have stay as they are, with whatever you changed." />
				<UAlert v-if="page.listing.status !== 'listed'" color="warning" variant="subtle" icon="i-lucide-eye-off" :title="page.listing.status === 'removed' ? 'Removed by a moderator' : 'Unlisted'" :description="page.listing.statusReason ?? 'Only its publisher, admins and moderators see it.'" />
				<p v-if="page.basedOn" class="text-sm text-muted">
					Based on <NuxtLink :to="`/explore/${page.basedOn.id}`" class="text-primary">{{ page.basedOn.name }}</NuxtLink>.
				</p>

				<ChatComark v-if="page.listing.description" :value="page.listing.description" :streaming="false" />

				<!-- Everything in it, readable before getting it. -->
				<section class="flex flex-col gap-3">
					<h2 class="font-semibold text-highlighted">
						What is inside
					</h2>

					<details v-for="entry in content.characters" :key="entry.key" class="rounded-md border border-default">
						<summary class="flex items-center gap-2 px-4 py-3 cursor-pointer">
							<UAvatar v-if="fileUrl(entry.avatarKey)" :src="fileUrl(entry.avatarKey)" :alt="entry.name" size="xs" />
							<UIcon v-else :name="LISTING_KINDS.character.icon" class="size-4 text-muted" />
							<span class="font-medium text-highlighted">{{ entry.name }}</span>
							<span class="text-xs text-dimmed">Character</span>
						</summary>
						<div class="flex flex-col gap-3 px-4 pb-4 text-sm">
							<div>
								<p class="text-xs font-medium text-muted">
									Instructions
								</p>
								<p class="whitespace-pre-wrap">
									{{ entry.instructions || '—' }}
								</p>
							</div>
							<div v-if="entry.greetings.length">
								<p class="text-xs font-medium text-muted">
									Greetings
								</p>
								<p v-for="(greeting, index) in entry.greetings" :key="index" class="whitespace-pre-wrap border-s-2 border-default ps-3 my-1">
									{{ greeting }}
								</p>
							</div>
							<div v-if="entry.examples">
								<p class="text-xs font-medium text-muted">
									Example dialogue
								</p>
								<p class="whitespace-pre-wrap">
									{{ entry.examples }}
								</p>
							</div>
							<div v-if="entry.note">
								<p class="text-xs font-medium text-muted">
									Closing note
								</p>
								<p class="whitespace-pre-wrap">
									{{ entry.note }}
								</p>
							</div>
							<p v-if="entry.libraryKeys.length" class="text-xs text-muted">
								Reads {{ entry.libraryKeys.map(libraryName).join(', ') }}.
							</p>
						</div>
					</details>

					<details v-for="library in content.libraries" :key="library.key" class="rounded-md border border-default">
						<summary class="flex items-center gap-2 px-4 py-3 cursor-pointer">
							<UIcon :name="LISTING_KINDS.library.icon" class="size-4 text-muted" />
							<span class="font-medium text-highlighted">{{ library.name }}</span>
							<span class="text-xs text-dimmed">Library, {{ library.entries.length }} {{ library.entries.length === 1 ? 'entry' : 'entries' }}{{ library.lorebook?.on ? ', a lorebook' : '' }}</span>
						</summary>
						<div class="flex flex-col gap-1 px-4 pb-4 text-sm">
							<p v-if="library.description" class="text-muted mb-2">
								{{ library.description }}
							</p>
							<template v-for="entry in tree(library.entries)" :key="entry.key">
								<details v-if="entry.kind === 'note'" :style="{ marginInlineStart: `${entry.depth * 1.25}rem` }">
									<summary class="flex items-center gap-2 cursor-pointer">
										<UIcon name="i-lucide-notebook-pen" class="size-4 text-muted" />{{ entry.name }}
										<span v-if="entry.tags.length" class="text-xs text-dimmed">{{ entry.tags.map(tag => `#${tag}`).join(' ') }}</span>
									</summary>
									<p class="whitespace-pre-wrap text-muted border-s-2 border-default ps-3 my-1">
										{{ entry.content }}
									</p>
								</details>
								<a v-else-if="entry.kind === 'file'" :href="fileUrl(entry.fileKey)" target="_blank" class="flex items-center gap-2 hover:text-primary" :style="{ marginInlineStart: `${entry.depth * 1.25}rem` }">
									<UIcon name="i-lucide-file" class="size-4 text-muted" />{{ entry.name }}
								</a>
								<p v-else class="flex items-center gap-2 font-medium" :style="{ marginInlineStart: `${entry.depth * 1.25}rem` }">
									<UIcon name="i-lucide-folder" class="size-4 text-muted" />{{ entry.name }}
								</p>
							</template>
						</div>
					</details>

					<details v-for="profile in content.structureProfiles" :key="profile.key" class="rounded-md border border-default">
						<summary class="flex items-center gap-2 px-4 py-3 cursor-pointer">
							<UIcon :name="LISTING_KINDS.structureProfile.icon" class="size-4 text-muted" />
							<span class="font-medium text-highlighted">{{ profile.name }}</span>
							<span class="text-xs text-dimmed">Structure profile</span>
						</summary>
						<ol class="flex flex-col gap-2 px-4 pb-4 text-sm list-decimal list-inside">
							<li v-for="block in profile.blocks" :key="block.id">
								<template v-if="block.kind === 'message'">
									A {{ block.role }} message: <span class="whitespace-pre-wrap text-muted">{{ block.text }}</span>
								</template>
								<template v-else-if="block.kind === 'files'">
									Files: <span class="text-muted">{{ block.paths.join(', ') || 'none yet' }}</span>
								</template>
								<template v-else>
									{{ { history: 'The conversation', autoFetch: 'Auto-fetched files', userCharacter: 'Your Character', participants: 'Who is here (group chats)' }[block.kind] }}
								</template>
							</li>
						</ol>
					</details>

					<div v-if="content.setup" class="rounded-md border border-default px-4 py-3 flex flex-col gap-2 text-sm">
						<p class="flex items-center gap-2">
							<UIcon name="i-lucide-folder-cog" class="size-4 text-muted" />
							<span class="font-medium text-highlighted">The setup</span>
							<span class="text-xs text-dimmed">a folder whose new chats start with it</span>
						</p>
						<p class="text-muted">
							{{ content.setup.mode === 'group' ? 'A group: the models answer in turn, each reading the others.' : 'Each model answers on its own.' }}
						</p>
						<ul v-if="content.setup.models" class="flex flex-col gap-1">
							<li v-for="(lane, index) in content.setup.models" :key="index" class="flex items-center gap-2">
								<UIcon name="i-lucide-bot" class="size-4 text-muted" />
								<span class="text-highlighted">{{ character(lane.characterKey)?.name ?? lane.name ?? `Model ${index + 1}` }}</span>
								<span class="text-xs text-dimmed">{{ lane.modelId ?? 'the default model' }}</span>
							</li>
						</ul>
						<p v-if="content.setup.libraryKeys.length || content.setup.structureProfileKey || content.setup.userCharacterKey" class="text-xs text-muted">
							<template v-if="content.setup.libraryKeys.length">
								Libraries: {{ content.setup.libraryKeys.map(libraryName).join(', ') }}.
							</template>
							<template v-if="content.setup.structureProfileKey">
								Structure profile: {{ profileName(content.setup.structureProfileKey) }}.
							</template>
							<template v-if="content.setup.userCharacterKey">
								You are {{ character(content.setup.userCharacterKey)?.name }}.
							</template>
						</p>
					</div>
				</section>

				<section class="flex flex-col gap-2">
					<h2 class="font-semibold text-highlighted">
						Versions
					</h2>
					<ul class="flex flex-col divide-y divide-default rounded-md border border-default text-sm">
						<li v-for="version in page.versions" :key="version.number" class="px-4 py-2 flex flex-col gap-0.5">
							<p class="text-highlighted">
								Version {{ version.number }} <span class="text-xs text-dimmed">{{ formatDistanceToNow(new Date(version.createdAt), { addSuffix: true }) }} · {{ fileSize(version.size) }}</span>
							</p>
							<p v-if="version.notes" class="text-muted whitespace-pre-wrap">
								{{ version.notes }}
							</p>
						</li>
					</ul>
				</section>
			</div>
			<div v-else class="w-full max-w-3xl mx-auto flex flex-col gap-3" aria-busy="true" aria-label="Loading the listing">
				<USkeleton class="h-16 w-full" />
				<USkeleton class="h-40 w-full" />
			</div>
		</template>
	</UDashboardPanel>
</template>
