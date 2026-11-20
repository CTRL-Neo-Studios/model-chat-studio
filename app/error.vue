<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps({
	error: Object as () => NuxtError,
})
</script>

<template>
	<UError
		:error="error"
		:ui="{
			statusMessage: 'font-brand',
			statusCode: 'font-mono text-2xl text-dimmed',
		}"
	/>
</template>

<style scoped>

</style>
