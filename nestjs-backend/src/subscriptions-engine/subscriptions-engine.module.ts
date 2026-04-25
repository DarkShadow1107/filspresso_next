import { Module } from "@nestjs/common";
import { SubscriptionsEngineController } from "./subscriptions-engine.controller";
import { SubscriptionsEngineService } from "./subscriptions-engine.service";

@Module({
  controllers: [SubscriptionsEngineController],
  providers: [SubscriptionsEngineService],
  exports: [SubscriptionsEngineService],
})
export class SubscriptionsEngineModule {}
