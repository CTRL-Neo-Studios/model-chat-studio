<script setup lang="ts">
// `?profile=` and `?folder=` are read once, so a change of either starts the screen afresh.
const route = useRoute()
</script>

<template>
	<NewChat :key="route.fullPath" :folder-id="typeof route.query.folder === 'string' ? route.query.folder : undefined" />
</template>
