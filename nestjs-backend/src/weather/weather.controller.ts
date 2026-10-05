import { Controller, Get, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { WeatherService } from "./weather.service";

@Controller("api/weather")
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Get()
  getWeather(@Query("lat") lat: string, @Query("lon") lon: string, @Req() req: Request) {
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

  @Get("recommendation")
  getRecommendation(@Query("lat") lat: string, @Query("lon") lon: string) {
    return this.weatherService.getRecommendation(parseFloat(lat), parseFloat(lon));
  }
}
