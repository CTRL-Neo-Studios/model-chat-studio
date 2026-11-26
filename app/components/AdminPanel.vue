<script setup lang="ts">
defineProps<{
	title: string
}>()

const { user } = useUserSession()

const { data: counts } = useQuery(exploreCountsQuery)
const waiting = computed(() => counts.value?.waiting ?? 0)

// Moderators manage users and Explore; the rest is for admins. The API enforces the same.
const links = computed(() => [
	{ label: 'Users', icon: 'i-lucide-users', to: '/admin/users' },
	{ label: 'Explore', icon: 'i-lucide-telescope', to: '/admin/explore' },
	{ label: 'Review', icon: 'i-lucide-shield-check', to: '/admin/review', badge: waiting.value || undefined },
	...(user.value?.role === 'admin'
		? [
				{ label: 'Invites', icon: 'i-lucide-ticket', to: '/admin/invites' },
				{ label: 'Models', icon: 'i-lucide-boxes', to: '/admin/models' },
				{ label: 'Settings', icon: 'i-lucide-settings', to: '/admin/settings' },
			]
		: []),
])

// The other tabs' lists load once an admin page is up, so switching tabs shows them at once. The model catalogs
// are large and load when their page opens.
const prefetch = usePrefetch()
onMounted(() => prefetch(usersQuery, ...(user.value?.role === 'admin' ? [invitesQuery, adminSettingsQuery] : [])))
</script>

<template>
	<!-- `min-h-0` keeps the panel at the layout's height so its body scrolls, as on the chat pages. -->
	<UDashboardPanel :id="`admin-${title.toLowerCase()}`" class="min-h-0">
		<template #header>
			<UDashboardNavbar :title="title">
				<template #right>
					<slot name="actions" />
					<UColorModeButton />
				</template>
			</UDashboardNavbar>
			<UDashboardToolbar>
				<UNavigationMenu :items="links" highlight class="-mx-1 flex-1" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-6">
				<slot />
			</div>
		</template>
	</UDashboardPanel>
</template>
