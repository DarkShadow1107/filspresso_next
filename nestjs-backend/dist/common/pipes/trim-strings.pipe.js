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
function trimDeep(value) {
    if (typeof value === "string") {
        return value.trim();
    }
    if (Array.isArray(value)) {
        return value.map((entry) => trimDeep(entry));
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value).map(([key, innerValue]) => [key, trimDeep(innerValue)]);
        return Object.fromEntries(entries);
    }
    return value;
}
let TrimStringsPipe = class TrimStringsPipe {
    transform(value) {
        return trimDeep(value);
    }
};
exports.TrimStringsPipe = TrimStringsPipe;
exports.TrimStringsPipe = TrimStringsPipe = __decorate([
    (0, common_1.Injectable)()
], TrimStringsPipe);
