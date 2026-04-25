"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Policy = exports.POLICY_METADATA_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.POLICY_METADATA_KEY = "policy_context";
const Policy = (context) => (0, common_1.SetMetadata)(exports.POLICY_METADATA_KEY, context);
exports.Policy = Policy;
