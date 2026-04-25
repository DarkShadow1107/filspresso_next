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
exports.ProductsController = void 0;
const common_1 = require("@nestjs/common");
const products_service_1 = require("./products.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
let ProductsController = class ProductsController {
    productsService;
    constructor(productsService) {
        this.productsService = productsService;
    }
    getCoffeeProducts() { return this.productsService.getCoffeeProducts(); }
    getCoffeeProduct(productId) {
        return this.productsService.getCoffeeProduct(productId);
    }
    getMachineProducts() { return this.productsService.getMachineProducts(); }
    getMachineProduct(productId) {
        return this.productsService.getMachineProduct(productId);
    }
    updateCoffeeStock(productId, req) {
        this.productsService.assertAdmin(req.user ?? {});
        const { stock } = req.body;
        return this.productsService.updateCoffeeStock(productId, Number(stock));
    }
    updateMachineStock(productId, req) {
        this.productsService.assertAdmin(req.user ?? {});
        const { stock } = req.body;
        return this.productsService.updateMachineStock(productId, Number(stock));
    }
    decreaseStock(req) {
        this.productsService.assertAdmin(req.user ?? {});
        const { items } = req.body;
        return this.productsService.decreaseStock(items ?? []);
    }
    syncProducts(req) {
        this.productsService.assertAdmin(req.user ?? {});
        return this.productsService.syncProducts(req.body);
    }
    resetCoffeeStatic(req) {
        this.productsService.assertAdmin(req.user ?? {});
        return this.productsService.resetCoffeeStatic();
    }
    deleteCoffeeProduct(req, productId) {
        this.productsService.assertAdmin(req.user ?? {});
        return { status: "success", productId, message: "Product deletion handled by admin module" };
    }
};
exports.ProductsController = ProductsController;
__decorate([
    (0, common_1.Get)("coffee"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "getCoffeeProducts", null);
__decorate([
    (0, common_1.Get)("coffee/:productId"),
    __param(0, (0, common_1.Param)("productId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "getCoffeeProduct", null);
__decorate([
    (0, common_1.Get)("machines"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "getMachineProducts", null);
__decorate([
    (0, common_1.Get)("machines/:productId"),
    __param(0, (0, common_1.Param)("productId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "getMachineProduct", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Put)("coffee/:productId/stock"),
    __param(0, (0, common_1.Param)("productId")),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "updateCoffeeStock", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Put)("machines/:productId/stock"),
    __param(0, (0, common_1.Param)("productId")),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "updateMachineStock", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("decrease-stock"),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "decreaseStock", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("sync"),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "syncProducts", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)("coffee/reset-static"),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "resetCoffeeStatic", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Delete)("coffee/:productId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("productId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "deleteCoffeeProduct", null);
exports.ProductsController = ProductsController = __decorate([
    (0, common_1.Controller)("api/products"),
    __metadata("design:paramtypes", [products_service_1.ProductsService])
], ProductsController);
