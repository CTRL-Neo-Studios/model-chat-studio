<script setup lang="ts">
useHead({ title: "Sign In/Sign Up" });

definePageMeta({
	middleware: ["signin-if-session-invalid"],
});
</script>

<template>
	<div />
</template>

<style scoped>
@reference "~/assets/css/main.css";
</style>
