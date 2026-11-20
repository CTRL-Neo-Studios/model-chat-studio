<script setup lang="ts">
const colorMode = useColorMode()
const themeColor = computed(() => colorMode.value === 'dark' ? '#0a0a0a' : '#fafafa')

const $rc = useRuntimeConfig()
const title = $rc.public.siteName as string || 'Model Chat Studio'
const description = 'A self-hosted AI chat for small groups.'

useHead({
	meta: [
		{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
		{ key: 'theme-color', name: 'theme-color', content: themeColor },
	],
	link: [{ rel: 'icon', href: '/favicon.ico' }],
	htmlAttrs: { lang: 'en' },
	titleTemplate: titleChunk => titleChunk && titleChunk !== title ? `${titleChunk} - ${title}` : title,
})

useSeoMeta({
	title,
	description,
	ogTitle: title,
	ogDescription: description,
})
</script>

<template>
	<UApp :toaster="{ position: 'top-right' }" :tooltip="{ delayDuration: 200 }">
		<NuxtLoadingIndicator color="var(--ui-primary)" />

		<NuxtLayout>
			<NuxtPage />
		</NuxtLayout>
	</UApp>
</template>
