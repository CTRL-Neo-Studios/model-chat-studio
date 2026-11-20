// Stands in for the Nuxt auto-imports that shared code relies on, since `bun test` runs outside Nuxt.
import { createRoleChecker } from '@type32/nuxt-cs-utils/runtime'

Object.assign(globalThis, { createRoleChecker })
