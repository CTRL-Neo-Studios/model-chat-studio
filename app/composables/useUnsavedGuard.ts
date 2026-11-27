import { LazyModalConfirm } from '#components'

/**
 * Asks before leaving a page with unsaved changes: another page of the app (a dialog), or the tab closed or reloaded
 * (the browser's own prompt). A change of the query alone, such as a Character's section, is not leaving.
 */
export function useUnsavedGuard(dirty: () => boolean) {
	const confirm = useOverlay().create(LazyModalConfirm)
	onBeforeRouteLeave(async () => !dirty() || await confirm.open({ title: 'Leave without saving?', description: 'Your changes on this page are lost.', color: 'error', confirmLabel: 'Leave' }).result)
	useEventListener('beforeunload', (event) => {
		if (dirty()) event.preventDefault()
	})
}
