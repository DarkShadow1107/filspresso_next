import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import configuration from "./config/configuration";
import { envValidationSchema } from "./config/env.validation";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { SecurityModule } from "./security/security.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { LegacyModule } from "./legacy/legacy.module";
import { AuthModule } from "./auth/auth.module";
import { AccountsModule } from "./accounts/accounts.module";
import { CardsModule } from "./cards/cards.module";
import { CartModule } from "./cart/cart.module";
import { OrdersModule } from "./orders/orders.module";
import { ProductsModule } from "./products/products.module";
import { FavoritesModule } from "./favorites/favorites.module";
import { AdminModule } from "./admin/admin.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { OperationsModule } from "./operations/operations.module";
import { CryptoModule } from "./crypto/crypto.module";
import { SecurityObservabilityModule } from "./security-observability/security-observability.module";
import { ChatModule } from "./chat/chat.module";
import { WeatherModule } from "./weather/weather.module";
import { RepairsModule } from "./repairs/repairs.module";
import { SubscriptionsEngineModule } from "./subscriptions-engine/subscriptions-engine.module";
import { KafelotModule } from "./kafelot/kafelot.module";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			load: [configuration],
			validationSchema: envValidationSchema,
			validationOptions: { abortEarly: false },
		}),
		SecurityModule,
		DatabaseModule,
		IntegrationsModule,
		HealthModule,
		SecurityObservabilityModule,
		LegacyModule,
		AuthModule,
		AccountsModule,
		CardsModule,
		CartModule,
		OrdersModule,
		ProductsModule,
		FavoritesModule,
		AdminModule,
		SubscriptionsModule,
		OperationsModule,
		CryptoModule,
		ChatModule,
		WeatherModule,
		RepairsModule,
		SubscriptionsEngineModule,
		KafelotModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
