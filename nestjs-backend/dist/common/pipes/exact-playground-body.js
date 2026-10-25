"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExactPlaygroundBody = exports.EXACT_PLAYGROUND_BODY = void 0;
const common_1 = require("@nestjs/common");
exports.EXACT_PLAYGROUND_BODY = "playground-exact-body";
const body = (0, common_1.createParamDecorator)((_data, context) => context.switchToHttp().getRequest().body);
/** These bounded contracts have their own closed validators. Generic normalization must
 * not alter signed argument bytes, source indentation/newlines, or original instructions.
 * Nest ValidationPipe skips custom decorators by default; route validation remains required.
 */
const ExactPlaygroundBody = () => body(exports.EXACT_PLAYGROUND_BODY);
exports.ExactPlaygroundBody = ExactPlaygroundBody;
