<script setup lang="ts">
// An admin page: its top bar with the breadcrumb and the page's actions, and its body. The admin area's sidebar
// (`SidebarArea`) lists the pages; moderators manage users and Explore, the rest is for admins. The API enforces the same.
defineProps<{
	title: string
}>()

const { user } = useUserSession()

// The other pages' lists load once an admin page is up, so switching shows them at once. The model catalogs
// are large and load when their page opens.
const prefetch = usePrefetch()
onMounted(() => prefetch(usersQuery, ...(user.value?.role === 'admin' ? [invitesQuery, adminSettingsQuery] : [])))
</script>

<template>
	<!-- `min-h-0` keeps the panel at the layout's height so its body scrolls, as on the chat pages. -->
	<UDashboardPanel :id="`admin-${title.toLowerCase()}`" class="min-h-0">
		<template #header>
			<PageNavbar>
				<template #right>
					<slot name="actions" />
				</template>
			</PageNavbar>
		</template>

		<template #body>
			<div class="w-full max-w-5xl mx-auto flex flex-col gap-6">
				<slot />
			</div>
		</template>
	</UDashboardPanel>
</template>
