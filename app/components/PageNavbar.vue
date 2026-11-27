<script setup lang="ts">
// A page's top bar: its breadcrumb (`Crumbs`, in `left`: the title slot is a heading, which cannot hold a nav), the
// page's own buttons, and light or dark.
defineProps<{ current?: string }>()
</script>

<template>
	<UDashboardNavbar :ui="{ left: 'min-w-0' }">
		<template #left>
			<Crumbs :current="current" />
		</template>
		<template #right>
			<slot name="right" />
			<UColorModeButton />
		</template>
	</UDashboardNavbar>
</template>
