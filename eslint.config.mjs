import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const globalIgnores = [
	"node_modules/**",
	".next/**",
	"out/**",
	"build/**",
	"next-env.d.ts",
	"deprecated/**",
	"public/legacy/**",
	"express-api/**",
	"go-ops-service/**",
	"java-invoice-service/**",
	"kotlin-subscription-service/**",
	"models/**",
	"rust-crypto-service/**",
	"rust-wasm/**",
	"docs/**",
	"infrastructure/**",
	"security/**",
	"logs/**",
	"playground/**",
	".npm/**",
	".venv/**",
	".vscode/**",
	"**/dist/**",
	"**/site-packages/**",
	"**/__pycache__/**",
	"**/*.pyc",
];

// `eslint-config-next` already registers react, react-hooks, @typescript-eslint,
// import and @next/next. Re-declaring them here makes the flat config throw
// `Cannot redefine plugin`, so this block only layers extra rules on top.
const eslintConfig = [
	{ ignores: globalIgnores },
	...nextCoreWebVitals,
	...nextTypeScript,
	{
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-require-imports": "warn",
			"@typescript-eslint/no-this-alias": "warn",
			"react-hooks/set-state-in-effect": "error",
			"react-hooks/purity": "warn",
			"react-hooks/preserve-manual-memoization": "warn",
			"react/no-unescaped-entities": "error",
		},
	},
	// These components render user-supplied images that `next/image` cannot
	// optimize or even accept: `data:` URLs, `blob:` object URLs, TOTP QR codes,
	// and avatars that need a manual `onError` src swap. `next/image` would
	// reject the blob/data sources or break the error fallback, so the rule is
	// disabled for them only rather than per-line with fragile comments.
	{
		files: [
			"src/components/AccountIconGenerator.tsx",
			"src/components/Cart.tsx",
			"src/components/account/AccountManagement.tsx",
			"src/components/account/sections/ProfileSection.tsx",
			"src/components/admin/AdminLoginClient.tsx",
			"src/components/CoffeeRecommender.tsx",
			"src/components/playground/PlaygroundSources.tsx",
		],
		rules: {
			"@next/next/no-img-element": "off",
		},
	},
];

export default eslintConfig;
