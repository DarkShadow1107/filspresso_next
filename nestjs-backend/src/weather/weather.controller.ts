import { Controller, Get, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { WeatherService } from "./weather.service";

@Controller("api/weather")
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Get()
  getWeather(@Query("lat") lat: string, @Query("lon") lon: string, @Req() req: Request) {
    const rawIp = (req.headers["x-forwarded-for"] as string | undefined) || req.ip || "";
    const clientIp = (Array.isArray(rawIp) ? rawIp[0] : String(rawIp).split(",")[0]).trim();
    return this.weatherService.getWeather(parseFloat(lat), parseFloat(lon), clientIp);
  }

  @Get("recommendation")
  getRecommendation(@Query("lat") lat: string, @Query("lon") lon: string) {
    return this.weatherService.getRecommendation(parseFloat(lat), parseFloat(lon));
  }
}
