// Both clients use the actual TSX icon library. No independently redrawn native glyphs.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const requireRoot = createRequire(path.join(root, "package.json"));
const ts = requireRoot("typescript");
const React = requireRoot("react");
const { renderToStaticMarkup } = requireRoot("react-dom/server");
const sharp = requireRoot("sharp");
const iconsRoot = path.join(root, "src/icons");
const artifacts = path.join(root, "playground-desktop/artifacts");
const output = path.join(artifacts, "shared-icons");
const branding = path.join(artifacts, "branding");

require.extensions[".tsx"] = function (module, file) {
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  module._compile(source, file);
};
require.extensions[".ts"] = require.extensions[".tsx"];

function writeIfChanged(target, bytes) {
  if (!fs.existsSync(target) || !fs.readFileSync(target).equals(Buffer.from(bytes))) fs.writeFileSync(target, bytes);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(branding, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(iconsRoot, "playground-icons.json"), "utf8"));
  for (const [name, entry] of Object.entries(manifest)) {
    const Component = require(path.join(iconsRoot, entry.source)).default;
    const markup = renderToStaticMarkup(React.createElement(Component, { size: 24, color: "#CBB5A4", ...entry.props }));
    const svg = markup.match(/<svg[\s\S]*?<\/svg>/)?.[0];
    if (!svg) throw new Error(`No SVG rendered from ${entry.source}`);
    writeIfChanged(path.join(output, `${name}.svg`), svg);
    // Rasterize the same glyphs for WinUI's unpackaged runtime. SVG/CSS support and
    // ms-appx URI resolution vary there; a local 3x PNG works without package identity.
    writeIfChanged(path.join(output, `${name}.png`), await sharp(Buffer.from(svg)).resize(72, 72).png().toBuffer());
    if (name === "send" || name === "stop") {
      const dark = renderToStaticMarkup(React.createElement(Component, { size: 24, color: "#322418", ...entry.props })).match(/<svg[\s\S]*?<\/svg>/)?.[0];
      writeIfChanged(path.join(output, `${name}-dark.svg`), dark);
      writeIfChanged(path.join(output, `${name}-dark.png`), await sharp(Buffer.from(dark)).resize(72, 72).png().toBuffer());
    }
  }

  // Derive the Windows icon from Filspresso's existing monogram, in the app palette.
  const mask = await sharp(path.join(root, "public/images/Logo_filspresso.png")).resize(208, 150, { fit: "contain", background: "#000" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(mask.info.width * mask.info.height * 4);
  for (let pixel = 0; pixel < mask.info.width * mask.info.height; pixel++) {
    rgba[pixel * 4] = 228; rgba[pixel * 4 + 1] = 179; rgba[pixel * 4 + 2] = 138;
    rgba[pixel * 4 + 3] = mask.data[pixel * mask.info.channels];
  }
  const monogram = await sharp(rgba, { raw: { width: mask.info.width, height: mask.info.height, channels: 4 } }).png().toBuffer();
  const background = Buffer.from('<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="250" height="250" rx="54" fill="#171314" stroke="#8F6344" stroke-width="5"/></svg>');
  const master = await sharp(background).composite([{ input: monogram, left: 24, top: 52 }]).png().toBuffer();
  writeIfChanged(path.join(branding, "Filspresso.png"), master);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = await Promise.all(sizes.map((size) => sharp(master).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const start = 6 + index * 16;
    header[start] = sizes[index] === 256 ? 0 : sizes[index]; header[start + 1] = header[start];
    header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(frame.length, start + 8); header.writeUInt32LE(offset, start + 12);
    offset += frame.length;
  });
  writeIfChanged(path.join(branding, "Filspresso.ico"), Buffer.concat([header, ...frames]));
  console.log(`Generated ${Object.keys(manifest).length} shared TSX icons and the multi-resolution Windows app icon.`);
}
main().catch((error) => { console.error(error); process.exit(1); });
