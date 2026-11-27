<script setup lang="ts">
import type { FolderDefaults } from '#shared/utils/folderDefaults'

/** A folder's defaults for new chats started in it (`FolderDefaultsForm`). */
const props = defineProps<{
	name: string
	defaults: FolderDefaults | null
	/** The folder has defaults of its own, which "Remove defaults" clears (`defaults` may be a setup to review). */
	own: boolean
	/** What a folder above would give when this one has none. */
	inherited: { from: string, defaults: FolderDefaults } | null
}>()

/** The new defaults (`null`: none of its own), or nothing when cancelled. */
const emit = defineEmits<{ close: [defaults?: FolderDefaults | null] }>()
const result = ref<FolderDefaults | null>(props.defaults)
</script>

<template>
	<UModal :title="`Defaults of “${name}”`" description="New chats started in this folder, or in a folder inside it without its own, begin with these. Anything not set starts as on the home page. Chats already there keep what they have." :ui="{ footer: 'flex-row-reverse justify-start' }">
		<template #body>
			<FolderDefaultsForm v-model:result="result" :defaults="defaults" :inherited="inherited" />
		</template>
		<template #footer>
			<UButton label="Save" @click="emit('close', result)" />
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
			<UButton v-if="own" color="neutral" variant="ghost" label="Remove defaults" class="me-auto" @click="emit('close', null)" />
		</template>
	</UModal>
</template>
