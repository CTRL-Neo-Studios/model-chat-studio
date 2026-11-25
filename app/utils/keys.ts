import type { ComputedRef, InjectionKey } from 'vue'

/** The chat's libraries the reader may add files to, provided by `ChatView` for the images in its answers. */
export const chatLibrariesKey: InjectionKey<ComputedRef<{ id: string, name: string }[]>> = Symbol('chatLibraries')
