"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const configuration_1 = __importDefault(require("./config/configuration"));
const env_validation_1 = require("./config/env.validation");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const database_module_1 = require("./database/database.module");
const health_module_1 = require("./health/health.module");
const security_module_1 = require("./security/security.module");
const integrations_module_1 = require("./integrations/integrations.module");
const auth_module_1 = require("./auth/auth.module");
const accounts_module_1 = require("./accounts/accounts.module");
const cards_module_1 = require("./cards/cards.module");
const cart_module_1 = require("./cart/cart.module");
const orders_module_1 = require("./orders/orders.module");
const products_module_1 = require("./products/products.module");
const favorites_module_1 = require("./favorites/favorites.module");
const admin_module_1 = require("./admin/admin.module");
const subscriptions_module_1 = require("./subscriptions/subscriptions.module");
const operations_module_1 = require("./operations/operations.module");
const crypto_module_1 = require("./crypto/crypto.module");
const security_observability_module_1 = require("./security-observability/security-observability.module");
const chat_module_1 = require("./chat/chat.module");
const weather_module_1 = require("./weather/weather.module");
const repairs_module_1 = require("./repairs/repairs.module");
const subscriptions_engine_module_1 = require("./subscriptions-engine/subscriptions-engine.module");
const kafelot_module_1 = require("./kafelot/kafelot.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [configuration_1.default],
                validationSchema: env_validation_1.envValidationSchema,
                validationOptions: { abortEarly: false },
            }),
            security_module_1.SecurityModule,
            database_module_1.DatabaseModule,
            integrations_module_1.IntegrationsModule,
            health_module_1.HealthModule,
            security_observability_module_1.SecurityObservabilityModule,
            auth_module_1.AuthModule,
            accounts_module_1.AccountsModule,
            cards_module_1.CardsModule,
            cart_module_1.CartModule,
            orders_module_1.OrdersModule,
            products_module_1.ProductsModule,
            favorites_module_1.FavoritesModule,
            admin_module_1.AdminModule,
            subscriptions_module_1.SubscriptionsModule,
            operations_module_1.OperationsModule,
            crypto_module_1.CryptoModule,
            chat_module_1.ChatModule,
            weather_module_1.WeatherModule,
            repairs_module_1.RepairsModule,
            subscriptions_engine_module_1.SubscriptionsEngineModule,
            kafelot_module_1.KafelotModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [app_service_1.AppService],
    })
], AppModule);
