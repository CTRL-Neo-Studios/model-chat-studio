<script setup lang="ts">
// `?project=` and `?profile=` are read once, so a change of them starts the screen afresh.
const route = useRoute()
</script>

<template>
	<NewChat :key="route.fullPath" />
</template>
