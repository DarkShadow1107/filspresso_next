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
exports.SecurityLoginTemplate = SecurityLoginTemplate;
const React = __importStar(require("react"));
const components_1 = require("@react-email/components");
const BaseLayout_1 = require("./BaseLayout");
function SecurityLoginTemplate({ displayName, ipAddress, userAgent, occurredAt }) {
    const safeName = displayName || "there";
    const prettyDate = occurredAt ? new Date(occurredAt).toLocaleString("en-US") : new Date().toLocaleString("en-US");
    return React.createElement(BaseLayout_1.BaseLayout, {
        previewText: "New login detected on your Filspresso account",
        title: "Security login notification",
        intro: "A new sign-in was detected for your account.",
    }, React.createElement(components_1.Text, null, `Hello ${safeName},`), React.createElement(components_1.Text, null, "A successful sign-in was detected on your Filspresso account. If this was you, no action is needed."), React.createElement(components_1.Text, null, `Time: ${prettyDate}`), React.createElement(components_1.Text, null, `IP address: ${ipAddress || "Unavailable"}`), React.createElement(components_1.Text, null, `Device: ${userAgent || "Unavailable"}`), React.createElement(components_1.Text, { style: { color: "#6b7280", fontSize: "13px" } }, "If this was not you, reset your password and review your account security settings immediately."));
}
