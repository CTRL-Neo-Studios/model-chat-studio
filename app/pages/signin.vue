<script setup lang="ts">
useHead({ title: "Sign in" });

definePageMeta({
	auth: 'guest',
});

const errors: Record<string, string> = {
	invite_required: "You need an invite link to join. Ask an admin for one.",
	invite_invalid: "This invite link is invalid, expired or already used.",
	signup_closed: "This instance is not accepting new members.",
	banned: "This account is banned.",
	github: "GitHub sign-in failed. Please try again.",
};

const route = useRoute();
const error = computed(() => {
	const code = route.query.error;
	return typeof code === 'string' ? errors[code] ?? "Sign-in failed. Please try again." : undefined;
});
</script>

<template>
	<UMain class="flex flex-col items-center justify-center gap-4 p-4">
		<UPageCard class="w-full max-w-md">
			<UAuthForm
				title="Sign in"
				description="Sign in with your GitHub account to continue."
				icon="i-lucide-log-in"
				:providers="[
					{
						label: 'Continue with GitHub',
						icon: 'i-simple-icons-github',
						to: '/auth/github',
						external: true,
					},
				]"
			/>
			<UAlert v-if="error" class="mt-6" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
		</UPageCard>
	</UMain>
</template>
