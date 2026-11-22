<script setup lang="ts">
// `?profile=` is read once, so a change of it starts the screen afresh.
const route = useRoute()
</script>

<template>
	<NewChat :key="route.fullPath" />
</template>
