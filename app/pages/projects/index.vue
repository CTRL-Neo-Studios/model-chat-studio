<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { formatDistanceToNow } from 'date-fns'
import { LazyModalConfirm, LazyModalDeleteProject, LazyModalRename } from '#components'

useHead({ title: 'Projects' })

const act = useApiAction()
const overlay = useOverlay()
const queryCache = useQueryCache()
const { data, isPending } = useQuery(projectsQuery)
const { pinnedFirst } = usePins()
const projects = computed(() => data.value ?? [])
const shown = computed(() => pinnedFirst('project', projects.value))
type Project = (typeof projects.value)[number]

const nameModal = overlay.create(LazyModalRename)
const confirm = overlay.create(LazyModalConfirm)
const deleteModal = overlay.create(LazyModalDeleteProject)
const { user } = useUserSession()

const nameProps = { heading: 'New project', description: 'A project holds files, notes and folders, and the chats about them.', placeholder: 'Project name', maxlength: 100 }

async function create() {
	const name = await nameModal.open(nameProps).result
	if (!name) return
	const project = await act<Project>('/api/v1/projects', { method: 'POST', body: { name } })
	if (!project) return
	queryCache.setQueryData(projectsQuery.key, list => [{ ...project, role: 'owner' as const }, ...(list ?? [])])
	await navigateTo(`/projects/${project.id}`)
}

// Renames and deletions show at once; the list comes back as it was if the server refuses.
async function rename(project: Project) {
	const name = await nameModal.open({ ...nameProps, title: project.name, heading: 'Rename project', description: 'Choose a new name for this project.' }).result
	if (!name || name === project.name) return
	const before = projects.value
	queryCache.setQueryData(projectsQuery.key, before.map(entry => entry.id === project.id ? { ...entry, name } : entry))
	if (!await act(`/api/v1/projects/${project.id}`, { method: 'PATCH', body: { name } })) queryCache.setQueryData(projectsQuery.key, before)
}

async function remove(project: Project) {
	const ownChats = await deleteModal.open({ projectId: project.id, name: project.name }).result
	if (!ownChats) return
	const before = projects.value
	queryCache.setQueryData(projectsQuery.key, before.filter(entry => entry.id !== project.id))
	if (!await act(`/api/v1/projects/${project.id}?ownChats=${ownChats}`, { method: 'DELETE', success: 'Project deleted' })) queryCache.setQueryData(projectsQuery.key, before)
	// The project's chats became ordinary ones, or were deleted.
	else queryCache.invalidateQueries({ key: chatsQuery.key, exact: true })
}

async function leave(project: Project) {
	const confirmed = await confirm.open({ title: 'Leave project', description: `You leave “${project.name}”. Your chats in it become ordinary chats.`, color: 'error' }).result
	if (!confirmed || !user.value) return
	const before = projects.value
	queryCache.setQueryData(projectsQuery.key, before.filter(entry => entry.id !== project.id))
	if (!await act(`/api/v1/projects/${project.id}/members/${user.value.id}`, { method: 'DELETE', success: 'You left the project' })) queryCache.setQueryData(projectsQuery.key, before)
	else queryCache.invalidateQueries({ key: chatsQuery.key, exact: true })
}

const ROLE_LABELS = { owner: 'Owner', editor: 'Editor', member: 'Member', viewer: 'Viewer' } as const
const actions = (project: Project): DropdownMenuItem[][] => project.role === 'owner'
	? [
			[{ label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => rename(project) }],
			[{ label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => remove(project) }],
		]
	: [[{ label: 'Leave project', icon: 'i-lucide-log-out', color: 'error', onSelect: () => leave(project) }]]
</script>

<template>
	<UDashboardPanel id="projects" class="min-h-0">
		<template #header>
			<UDashboardNavbar title="Projects">
				<template #right>
					<UButton icon="i-lucide-plus" label="New project" @click="create" />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-4">
				<div v-if="isPending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading projects">
					<USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
				</div>
				<UEmpty
					v-else-if="!projects.length"
					icon="i-lucide-folder-kanban"
					title="No projects yet"
					description="A project keeps files, notes and folders together, for the chats about them."
					:actions="[{ label: 'New project', icon: 'i-lucide-plus', onClick: create }]"
				/>
				<ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<li v-for="project in shown" :key="project.id" class="relative flex flex-col gap-2 rounded-md border border-default p-4 hover:bg-elevated/50 has-focus-visible:ring-2 has-focus-visible:ring-primary">
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-folder-kanban" class="size-5 text-muted shrink-0" />
							<!-- The link covers the card; the buttons sit above it. -->
							<NuxtLink :to="`/projects/${project.id}`" class="font-medium text-highlighted truncate flex-1 outline-none after:absolute after:inset-0">
								{{ project.name }}
							</NuxtLink>
							<div class="relative flex items-center">
								<PinButton kind="project" :target-id="project.id" />
								<UDropdownMenu :items="actions(project)" :content="{ align: 'end' }">
									<UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Project actions" />
								</UDropdownMenu>
							</div>
						</div>
						<p v-if="project.description" class="text-sm text-muted line-clamp-2">
							{{ project.description }}
						</p>
						<div class="flex items-center gap-2 mt-auto">
							<span class="text-xs text-dimmed">Created {{ formatDistanceToNow(new Date(project.createdAt), { addSuffix: true }) }}</span>
							<UBadge v-if="project.role !== 'owner'" :label="`Shared · ${ROLE_LABELS[project.role]}`" color="neutral" variant="subtle" size="sm" class="ms-auto" />
						</div>
					</li>
				</ul>
			</div>
		</template>
	</UDashboardPanel>
</template>
