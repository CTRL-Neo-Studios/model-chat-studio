<script setup lang="ts">
useHead({ title: "Home" });

const { user, clear } = useUserSession();

async function signOut() {
	await clear();
	await navigateTo('/signin');
}
</script>

<template>
	<UMain class="flex flex-col items-center justify-center gap-4 p-4">
		<UPageCard
			class="w-full max-w-md"
			:title="`Signed in as ${user?.name || user?.username}`"
			description="The chat is not available yet."
		>
			<template #footer>
				<UButton label="Sign out" icon="i-lucide-log-out" color="neutral" variant="subtle" @click="signOut" />
			</template>
		</UPageCard>
	</UMain>
</template>
