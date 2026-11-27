<script setup lang="ts">
useHead({ title: 'Your data' })
</script>

<template>
	<UDashboardPanel id="settings-data" class="min-h-0">
		<template #header>
			<PageNavbar />
		</template>

		<template #body>
			<div class="w-full max-w-2xl mx-auto flex flex-col gap-6">
				<UPageCard title="Your chats" description="Every chat you own in one file, a chat file per line, without attachments: for keeping. To move a chat, export it from its menu and import it." variant="subtle">
					<div>
						<UButton label="Export all my chats" icon="i-lucide-download" color="neutral" variant="subtle" to="/api/v1/me/export" external download />
					</div>
				</UPageCard>
			</div>
		</template>
	</UDashboardPanel>
</template>
