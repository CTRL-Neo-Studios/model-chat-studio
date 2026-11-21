<script setup lang="ts">
const props = withDefaults(defineProps<{
	/** The current name. */
	title?: string
	heading?: string
	description?: string
	placeholder?: string
	maxlength?: number
}>(), { title: '', heading: 'Rename chat', description: 'Choose a new title for this chat.', placeholder: 'Chat title', maxlength: 200 })

const emit = defineEmits<{ close: [string | false] }>()

const value = ref(props.title)
const trimmed = computed(() => value.value.trim())

function submit() {
	if (!trimmed.value) return
	emit('close', trimmed.value)
}
</script>

<template>
	<UModal
		:title="heading"
		:description="description"
		:ui="{ footer: 'flex-row-reverse justify-start' }"
		:close="false"
	>
		<template #body>
			<UInput
				v-model="value"
				autofocus
				size="lg"
				:placeholder="placeholder"
				:maxlength="maxlength"
				class="w-full"
				:ui="{ root: 'w-full' }"
				@keydown.enter.prevent="submit"
			/>
		</template>

		<template #footer>
			<UButton label="Save" :disabled="!trimmed" @click="submit" />
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close', false)" />
		</template>
	</UModal>
</template>
