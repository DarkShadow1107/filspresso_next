"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WeatherController = void 0;
const common_1 = require("@nestjs/common");
const weather_service_1 = require("./weather.service");
let WeatherController = class WeatherController {
    weatherService;
    constructor(weatherService) {
        this.weatherService = weatherService;
    }
    getWeather(lat, lon, req) {
        // `req.ip`, not the raw header. Express resolves it according to the configured
        // `trust proxy` (TRUST_PROXY, set to 1 for Caddy), so this route can no longer be
        // handed an arbitrary address by a caller that sets x-forwarded-for itself.
        // Reading the header directly -- which is what this did -- bypassed that decision
        // entirely: the header was trusted whatever trust proxy said.
        //
        // Only the displayed city/country depends on this. The forecast comes from the
        // lat/lon query parameters, and a private or absent address simply yields no
        // location rather than an error.
        const clientIp = String(req.ip || "").trim();
        return this.weatherService.getWeather(parseFloat(lat), parseFloat(lon), clientIp);
    }
    getRecommendation(lat, lon) {
        return this.weatherService.getRecommendation(parseFloat(lat), parseFloat(lon));
    }
};
exports.WeatherController = WeatherController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)("lat")),
    __param(1, (0, common_1.Query)("lon")),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], WeatherController.prototype, "getWeather", null);
__decorate([
    (0, common_1.Get)("recommendation"),
    __param(0, (0, common_1.Query)("lat")),
    __param(1, (0, common_1.Query)("lon")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], WeatherController.prototype, "getRecommendation", null);
exports.WeatherController = WeatherController = __decorate([
    (0, common_1.Controller)("api/weather"),
    __metadata("design:paramtypes", [weather_service_1.WeatherService])
], WeatherController);
