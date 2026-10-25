/** Standalone StrictMode fixture: no Next build/server is modified or restarted. */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("../nestjs-backend/node_modules/esbuild");
const root = path.resolve(__dirname, "..");
const output = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "filspresso-agent-browser-validation");
fs.mkdirSync(output, { recursive: true });
esbuild.buildSync({
	stdin: { contents: `import * as React from 'react'; import {createRoot} from 'react-dom/client';
import Workspace from './src/components/playground/PlaygroundAgentWorkspace';
createRoot(document.getElementById('root')).render(<React.StrictMode><Workspace context={{model:'lfm2_5_230m_q4_k_m',inputContextTokens:16384}} /></React.StrictMode>);`,
		resolveDir: root, sourcefile: "agent-browser-fixture.tsx", loader: "tsx" },
	bundle: true, platform: "browser", target: "es2022", jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), outfile: path.join(output, "fixture.js"),
	define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning",
});
fs.writeFileSync(path.join(output, "index.html"), '<!doctype html><meta charset="utf-8"><title>Agent workspace test fixture</title><div id="root"></div><script src="/fixture.js"></script>');
console.log("Built isolated StrictMode browser fixture.");
