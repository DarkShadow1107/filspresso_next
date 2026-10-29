// Mounted UI fixture only. Never calls live inference, billing or a real account.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const esbuild = require(path.join(root, "nestjs-backend/node_modules/esbuild"));
const output = path.join(process.env.LOCALAPPDATA, "Temp/opencode/filspresso-playground-refinements");
fs.mkdirSync(output, { recursive: true });
async function main() {
await esbuild.build({
	stdin: { contents: `import * as React from 'react'; import {createRoot} from 'react-dom/client';
import Workspace from './src/components/playground/PlaygroundWorkspace';
createRoot(document.getElementById('root')).render(<React.StrictMode><Workspace tier="ultimate" access="tier" /></React.StrictMode>);`,
		resolveDir: root, sourcefile: "playground-refinement-fixture.tsx", loader: "tsx" },
	bundle: true, platform: "browser", target: "es2022", jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"),
	outfile: path.join(output, "fixture.js"), define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
	plugins: [{ name: "fixture-link", setup(build) {
		build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
		build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'import * as React from "react"; export default function Link({children,...props}) { return <a {...props}>{children}</a>; }', loader: "jsx", resolveDir: root }));
	} }],
});
fs.writeFileSync(path.join(output, "fixture.css"), ["src/styles/globals.css", "src/styles/playground-workspace.css"].map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n"));
fs.copyFileSync(path.join(root, "public/fonts/poppins-v24-devanagari_latin_latin-ext-regular.ttf"), path.join(output, "poppins.ttf"));
fs.writeFileSync(path.join(output, "index.html"), `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Playground refinement fixture</title>
<link rel="stylesheet" href="fixture.css"><style>@font-face{font-family:Poppins;src:url('/poppins.ttf')}*{box-sizing:border-box;font-family:Poppins,sans-serif}body{margin:0;background:#100f10;color:#f2e5dc} .header_body{top:0;height:88px;display:flex;align-items:center;padding:0 24px;background:#141213} </style>
<body><div class="header_body">FILSPRESSO · fixture navigation</div><main id="root"></main><footer style="padding:20px">Fixture footer</footer><script src="fixture.js"></script></body></html>`);
console.log(`Built isolated refinement fixture in ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
