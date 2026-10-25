import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

export const EXACT_PLAYGROUND_BODY = "playground-exact-body";
const body = createParamDecorator((_data: unknown, context: ExecutionContext) => context.switchToHttp().getRequest().body);
/** These bounded contracts have their own closed validators. Generic normalization must
 * not alter signed argument bytes, source indentation/newlines, or original instructions.
 * Nest ValidationPipe skips custom decorators by default; route validation remains required.
 */
export const ExactPlaygroundBody = () => body(EXACT_PLAYGROUND_BODY);
