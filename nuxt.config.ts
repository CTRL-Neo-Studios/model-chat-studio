// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
	modules: [
		// A real build without DATABASE_URL would otherwise fall back to PGlite silently.
		// `nuxt prepare` and `nuxt typecheck` are skipped: they also run as "production" and
		// would switch the driver under a running dev server. Must stay above '@nuxthub/core'.
		(_options, nuxt) => {
			const hub = nuxt.options.hub
			if (!nuxt.options.dev && !nuxt.options._prepare && hub && typeof hub.db === 'object') {
				hub.db.driver = 'postgres-js'
			}
		},
		'@nuxt/eslint',
		'@nuxt/ui',
		'@comark/vue',
		'@type32/nuxt-ui-extras',
		'@nuxt/image',
		'@nuxtjs/i18n',
		'nuxt-auth-utils',
		'nuxt-authorization',
		'@type32/nuxt-cs-utils',
		'@nuxthub/core',
		'@vueuse/nuxt',
		'nuxt-security',
		'motion-v/nuxt'
	],

	experimental: {
		// The prompt morphs from the home page into the chat page.
		viewTransition: true,
	},

	devtools: {
		enabled: true
	},

	vite: {
		optimizeDeps: {
			include: [
				'zod',
				'@internationalized/date',
			]
		},
	},

	hub: {
		db: {
			dialect: 'postgresql',
			applyMigrationsDuringBuild: false,
			applyMigrationsDuringDev: true,
		},
		blob: true,
	},

	css: ['~/assets/css/main.css'],

	routeRules: {
		// nuxt-auth-utils clears the session with a DELETE that carries no CSRF token.
		'/api/_auth/session': { csurf: false },
	},

	security: {
		headers: {
			contentSecurityPolicy: {
				'img-src': ["'self'", 'data:', 'https:', 'blob:'],
			},
			crossOriginEmbedderPolicy: false, // TODO: Find a better solution than disabling this security measure.
		},
		csrf: {
			methodsToProtect: ['POST', 'PUT', 'PATCH', 'DELETE'],
		},
		rateLimiter: {
			interval: 100000,
		}
	},

	$development: {
		security: {
			headers: {
				// Dev runs on plain http. Safari applies these to localhost and upgrades every asset request
				// to https, so the page loads without styles or scripts.
				contentSecurityPolicy: { 'upgrade-insecure-requests': false },
				strictTransportSecurity: false,
			},
		},
		runtimeConfig: {
			// Safari drops `Secure` cookies on plain http, so the session would never stick in dev.
			session: { cookie: { secure: false } },
		},
	},

	image: {
		domains: [],
		provider: 'none', // or configure ipx with a custom fetchAdapter
	},

	runtimeConfig: {
		oauth: {
			github: {
				clientId: '',
				clientSecret: ''
			}
		},
		public: {
			siteName: '',
			siteUrl: '',
		},
	},

	compatibilityDate: '2026-06-05',
})
