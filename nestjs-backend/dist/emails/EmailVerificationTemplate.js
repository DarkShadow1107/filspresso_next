"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailVerificationTemplate = EmailVerificationTemplate;
const React = __importStar(require("react"));
const components_1 = require("@react-email/components");
const BaseLayout_1 = require("./BaseLayout");
function EmailVerificationTemplate({ displayName, verificationUrl }) {
    const safeName = displayName || "there";
    return React.createElement(BaseLayout_1.BaseLayout, {
        previewText: "Verify your Filspresso account",
        title: "Verify your Filspresso email",
        intro: "One click keeps your account secure.",
    }, React.createElement(components_1.Text, null, `Hello ${safeName},`), React.createElement(components_1.Text, null, "Welcome to Filspresso. Please verify your email address to secure your account and enable transactional updates."), React.createElement(components_1.Button, { href: verificationUrl, style: styles.button }, "Verify Email Address"), React.createElement(components_1.Text, { style: styles.muted }, "If the button does not work, copy and paste this link in your browser:"), React.createElement(components_1.Link, { href: verificationUrl, style: styles.link }, verificationUrl));
}
const styles = {
    button: {
        backgroundColor: "#d97706",
        borderRadius: "8px",
        color: "#ffffff",
        fontWeight: "600",
        padding: "12px 16px",
        textDecoration: "none",
        display: "inline-block",
        margin: "10px 0",
    },
    muted: {
        color: "#6b7280",
        fontSize: "13px",
    },
    link: {
        wordBreak: "break-all",
    },
};
