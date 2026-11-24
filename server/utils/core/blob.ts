import { createBlobStorage } from '@nuxthub/core/blob'
import { createDriver as createS3Driver } from '@nuxthub/core/blob/drivers/s3'
import { createDriver as createFsDriver } from '@nuxthub/core/blob/drivers/fs'

const env = process.env

/**
 * File storage, configured from the environment when the server starts, so no credentials end up in the build
 * output (NuxtHub's own `hub:blob` writes them in at build time). S3 when its variables are set, as NuxtHub
 * decides; otherwise files in `.data/blob` under the working directory.
 */
export const blob = createBlobStorage(
	env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && (env.S3_BUCKET || env.S3_ENDPOINT)
		? createS3Driver({
				accessKeyId: env.S3_ACCESS_KEY_ID,
				secretAccessKey: env.S3_SECRET_ACCESS_KEY,
				bucket: env.S3_BUCKET || '',
				region: env.S3_REGION || 'auto',
				endpoint: env.S3_ENDPOINT,
			})
		: createFsDriver({ dir: '.data/blob' }),
)
