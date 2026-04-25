"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRepoRoot = resolveRepoRoot;
exports.resolveExpressApiPath = resolveExpressApiPath;
exports.requireFromExpressApi = requireFromExpressApi;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function resolveNestBackendRoot() {
    return node_path_1.default.resolve(__dirname, "..", "..", "..");
}
function resolveRepoRoot() {
    return node_path_1.default.resolve(resolveNestBackendRoot(), "..");
}
function resolveExpressApiPath(...segments) {
    // Now mapped to the internal legacy-bridge to allow the external express-api folder to be deleted.
    return node_path_1.default.join(resolveNestBackendRoot(), "src", "legacy-bridge", ...segments);
}
function requireFromExpressApi(relativePath) {
    const normalized = relativePath.replace(/^[\\/]+/, "");
    const absolutePath = resolveExpressApiPath(normalized);
    if (!node_fs_1.default.existsSync(absolutePath)) {
        throw new Error(`Express API module was not found at ${absolutePath}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(absolutePath);
}
