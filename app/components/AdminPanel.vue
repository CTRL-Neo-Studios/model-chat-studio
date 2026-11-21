<script setup lang="ts">
defineProps<{
	title: string
}>()

const { user } = useUserSession()

// Moderators manage users only; the rest is for admins. The API enforces the same.
const links = computed(() => [
	{ label: 'Users', icon: 'i-lucide-users', to: '/admin/users' },
	...(user.value?.role === 'admin'
		? [
				{ label: 'Invites', icon: 'i-lucide-ticket', to: '/admin/invites' },
				{ label: 'Models', icon: 'i-lucide-boxes', to: '/admin/models' },
				{ label: 'Settings', icon: 'i-lucide-settings', to: '/admin/settings' },
			]
		: []),
])
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
