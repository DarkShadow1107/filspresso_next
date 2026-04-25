const legacyMailer = require("../../legacy-bridge/utils/resendMailer") as {
  sendTransactionalEmail: (payload: any) => Promise<any>;
  buildEmailVerificationHtml: (payload: any) => string;
  buildOrderEmailHtml: (payload: any) => string;
  buildWelcomeHtml: (payload: any) => string;
  buildSecurityLoginHtml: (payload: any) => string;
  escapeHtml: (value: string) => string;
  formatMoney: (value: any, currency?: string) => string;
  toAbsoluteImageUrl: (imageUrl: string) => string;
};

export const sendTransactionalEmail = legacyMailer.sendTransactionalEmail;
export const buildEmailVerificationHtml = legacyMailer.buildEmailVerificationHtml;
export const buildOrderEmailHtml = legacyMailer.buildOrderEmailHtml;
export const buildWelcomeHtml = legacyMailer.buildWelcomeHtml;
export const buildSecurityLoginHtml = legacyMailer.buildSecurityLoginHtml;
export const escapeHtml = legacyMailer.escapeHtml;
export const formatMoney = legacyMailer.formatMoney;
export const toAbsoluteImageUrl = legacyMailer.toAbsoluteImageUrl;
