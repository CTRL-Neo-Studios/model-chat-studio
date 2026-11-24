import { z } from 'zod'
// Relative, not `hub:db`, so this module also loads in `bun test`.
import { pinKinds } from '../../db/schema'

/** `/pins/:kind/:targetId`. */
export const pinParamsSchema = z.object({ kind: z.enum(pinKinds), targetId: z.uuid() })
