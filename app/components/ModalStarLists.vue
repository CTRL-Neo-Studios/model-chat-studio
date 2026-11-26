<script setup lang="ts">
/** "Add to a list…": the member's lists as checkboxes, and new ones by name. Putting a listing in a list stars it. */
const props = defineProps<{ name: string, lists: { id: string, name: string }[], selected: string[] }>()
const emit = defineEmits<{ close: [result?: { selected: string[], created: string[] }] }>()

const chosen = ref<string[]>([...props.selected])
const created = ref<string[]>([])
const newName = ref('')
function addList() {
	const name = newName.value.trim()
	if (!name || created.value.includes(name)) return
	created.value.push(name)
	newName.value = ''
}
</script>

<template>
	<UModal :title="`Add “${name}” to a list`" description="Putting it in a list stars it; taking the star away takes it out of every list." :ui="{ footer: 'justify-end' }" @update:open="emit('close')">
		<template #body>
			<div class="flex flex-col gap-3">
				<UCheckbox v-for="list in lists" :key="list.id" :model-value="chosen.includes(list.id)" :label="list.name" @update:model-value="on => chosen = on ? [...chosen, list.id] : chosen.filter(id => id !== list.id)" />
				<UCheckbox v-for="listName in created" :key="`new:${listName}`" :model-value="true" :label="`${listName} (new)`" @update:model-value="created = created.filter(entry => entry !== listName)" />
				<p v-if="!lists.length && !created.length" class="text-sm text-muted">
					No lists yet.
				</p>
				<div class="flex gap-2">
					<UInput v-model="newName" placeholder="New list, e.g. Productivity" :maxlength="60" class="flex-1" @keydown.enter.prevent="addList" />
					<UButton label="Add" icon="i-lucide-plus" color="neutral" variant="subtle" :disabled="!newName.trim()" @click="addList" />
				</div>
			</div>
		</template>
		<template #footer>
			<UButton color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
			<UButton label="Save" @click="emit('close', { selected: chosen, created })" />
		</template>
	</UModal>
</template>
