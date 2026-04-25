import { Controller, Post, Get, Put, Delete, Req, Res, HttpStatus, UseInterceptors, UploadedFile } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { AdminService } from "./admin.service";
import * as path from "path";

const { diskStorage } = require("multer") as {
  diskStorage: (options: Record<string, unknown>) => unknown;
};

interface AuthenticatedRequest extends Request {
  user?: Record<string, any>;
  adminSession?: any;
  adminSensitiveView?: boolean;
}

@Controller("api/admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post("login")
  async login(@Req() req: Request, @Res() res: Response) {
    const result = await this.adminService.login(req, res);
    if (!res.headersSent) {
      if ((result as any).status === "mfa_required" || (result as any).status === "mfa_enrollment_required") {
        return res.status(HttpStatus.ACCEPTED).json(result);
      }
      return res.status(HttpStatus.OK).json(result);
    }
  }

  @Post("mfa/verify")
  async mfaVerify(@Req() req: Request, @Res() res: Response) {
    const result = await this.adminService.mfaVerify(req, res);
    if (!res.headersSent) {
      return res.status(HttpStatus.OK).json(result);
    }
  }

  @Post("logout")
  async logout(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.logout(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Get("session")
  async session(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.session(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Post("sensitive/unlock")
  async sensitiveUnlock(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.sensitiveUnlock(req, res);
    if (!res.headersSent) {
      return res.status(HttpStatus.OK).json(result);
    }
  }

  @Post("sensitive/lock")
  async sensitiveLock(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.sensitiveLock(req, res);
    return res.status(HttpStatus.OK).json(result);
  }

  @Get("tables")
  async getTables(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.getTables(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Get("table-info/:table")
  async getTableInfo(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.getTableInfo(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Get("tables/:table")
  async getTableData(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.getTableData(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Post("tables/:table")
  async insertRow(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.insertRow(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Put("tables/:table/:id")
  async updateRow(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.updateRow(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Delete("tables/:table/:id")
  async deleteRow(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.deleteRow(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Post("query")
  async executeQuery(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.executeQuery(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Get("security/telemetry")
  async getTelemetry(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.getTelemetry(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Get("security/events")
  async getSecurityEvents(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.getSecurityEvents(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Delete("security/lockouts/:loginKey")
  async clearLockout(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    const result = await this.adminService.clearLockout(req);
    return res.status(HttpStatus.OK).json(result);
  }

  @Post("upload/coffee-image")
  @UseInterceptors(FileInterceptor("image", {
    storage: diskStorage({
      destination: (req: any, file: any, cb: any) => {
        try {
          const { product_type: productType = "", category = "" } = req.body || {};
          const adminService = (req as any).__adminService; // Hack to access service method
          const target = adminService.resolveImageTarget(productType, category);
          req.uploadTarget = target;
          require("fs").mkdirSync(target.absoluteDir, { recursive: true });
          cb(null, target.absoluteDir);
        } catch (err) {
          cb(err, "");
        }
      },
      filename: (req: any, file: any, cb: any) => {
        const adminService = (req as any).__adminService;
        if (!adminService.isAllowedImage(file)) {
          return cb(new Error("Invalid image type"), "");
        }
        const safeName = require("path").basename(file.originalname);
        cb(null, safeName);
      }
    }),
    fileFilter: (req: any, file: any, cb: any) => {
      const adminService = (req as any).__adminService;
      if (!adminService.isAllowedImage(file)) {
        return cb(new Error("Only png, avif, webp, jpg, or jpeg are allowed"), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 15 * 1024 * 1024 }
  }))
  async uploadImage(@Req() req: AuthenticatedRequest, @Res() res: Response, @UploadedFile() file: any) {
    await this.adminService.authenticateAdmin(req, res);
    if (res.headersSent) return;
    
    if (!file) {
      return res.status(400).json({ error: "No image file provided" });
    }
    const productType = (req.body?.product_type || "").toString().trim();
    const category = (req.body?.category || "").toString().trim();
    if (!productType || !category) {
      if (file.path) require("fs").unlink(file.path, () => {});
      return res.status(400).json({ error: "product_type and category are required before uploading an image" });
    }
    
    const target = (req as any).uploadTarget;
    const extension = path.extname(file.filename || "").toLowerCase().replace(".", "");
    const relativePath = path.join(target.relativeDir, file.filename).replace(/\\/g, "/");
    
    return res.status(HttpStatus.OK).json({ status: "success", filename: file.filename, extension, relativePath });
  }
}
