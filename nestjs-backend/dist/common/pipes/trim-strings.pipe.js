"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrimStringsPipe = void 0;
const common_1 = require("@nestjs/common");
/**
 * Recursively trim every string in a payload.
 *
 * Phase 8.2. The previous version rebuilt every object and array with
 * `Object.fromEntries`/`map`, which meant a request body was allocated a second and
 * third time over: once by `JSON.parse`, once by `Object.entries`, once by
 * `fromEntries`. On the routes that use this pipe it was the second-largest CPU cost
 * after parsing itself.
 *
 * Two changes:
 *
 *  - Objects and arrays are walked in place. Nothing is reallocated, so a body with
 *    nothing to trim costs no garbage at all.
 *  - A subtree that contains no strings needing a trim is left completely alone.
 *    `changed` propagates upward so an untouched branch of a large body is not
 *    rewritten key by key.
 *
 * A depth cap stops a deeply nested or cyclic payload from recursing without bound.
 * Nest's own `ValidationPipe` is not a defence here: this pipe runs on routes that do
 * not use it, and a body can be arbitrarily nested.
 */
const MAX_TRIM_DEPTH = 64;
/** Returns the trimmed value, and whether anything actually changed. */
function trimDeep(value, depth = 0) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === value ? { value, changed: false } : { value: trimmed, changed: true };
    }
    if (depth >= MAX_TRIM_DEPTH)
        return { value, changed: false };
    if (Array.isArray(value)) {
        let changed = false;
        for (let i = 0; i < value.length; i += 1) {
            const result = trimDeep(value[i], depth + 1);
            if (result.changed) {
                value[i] = result.value;
                changed = true;
            }
        }
        return { value, changed };
    }
    if (value && typeof value === "object") {
        const record = value;
        let changed = false;
        for (const key of Object.keys(record)) {
            const result = trimDeep(record[key], depth + 1);
            if (result.changed) {
                record[key] = result.value;
                changed = true;
            }
        }
        return { value: record, changed };
    }
    return { value, changed: false };
}
let TrimStringsPipe = class TrimStringsPipe {
    transform(value) {
        return trimDeep(value).value;
    }
};
exports.TrimStringsPipe = TrimStringsPipe;
exports.TrimStringsPipe = TrimStringsPipe = __decorate([
    (0, common_1.Injectable)()
], TrimStringsPipe);
