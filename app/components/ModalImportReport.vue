<script setup lang="ts">
/** What a card import converted or left unused. */
defineProps<{
	name: string
	report: string[]
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
	<UModal :title="`Imported “${name}”`" description="The card is now a Character of yours. A few things about it:" :ui="{ footer: 'justify-end' }" @update:open="emit('close')">
		<template #body>
			<ul class="list-disc ps-5 flex flex-col gap-1.5 text-sm">
				<li v-for="line in report" :key="line">
					{{ line }}
				</li>
			</ul>
		</template>
		<template #footer>
			<UButton label="Done" @click="emit('close')" />
		</template>
	</UModal>
</template>
