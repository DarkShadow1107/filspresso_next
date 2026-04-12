import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import tsEslintPlugin from "@typescript-eslint/eslint-plugin";

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
];

const eslintConfig = [
	{ ignores: globalIgnores },
	...nextCoreWebVitals,
	...nextTypeScript,
	{
		plugins: {
			react: reactPlugin,
			"react-hooks": reactHooksPlugin,
			"@typescript-eslint": tsEslintPlugin,
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-require-imports": "warn",
			"@typescript-eslint/no-this-alias": "warn",
			"react-hooks/set-state-in-effect": "warn",
			"react-hooks/purity": "warn",
			"react-hooks/preserve-manual-memoization": "warn",
			"react/no-unescaped-entities": "warn",
		},
	},
];

export default eslintConfig;
