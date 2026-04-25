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
exports.BaseLayout = BaseLayout;
const React = __importStar(require("react"));
const components_1 = require("@react-email/components");
function BaseLayout({ previewText, title, intro, children }) {
    return React.createElement(components_1.Html, null, React.createElement(components_1.Head, null), React.createElement(components_1.Preview, null, previewText || intro || title), React.createElement(components_1.Body, { style: styles.body }, React.createElement(components_1.Container, { style: styles.container }, React.createElement(components_1.Section, { style: styles.header }, React.createElement(components_1.Heading, { as: "h2", style: styles.title }, title), React.createElement(components_1.Text, { style: styles.intro }, intro)), React.createElement(components_1.Section, { style: styles.content }, children))));
}
const styles = {
    body: {
        backgroundColor: "#f5f7fb",
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
        margin: 0,
        padding: "24px 8px",
        color: "#1b1f23",
    },
    container: {
        maxWidth: "760px",
        backgroundColor: "#ffffff",
        borderRadius: "14px",
        border: "1px solid #e6e9ef",
        overflow: "hidden",
    },
    header: {
        padding: "20px 24px",
        background: "linear-gradient(120deg, #fff4e6, #fdebd0)",
        borderBottom: "1px solid #f2d7b3",
    },
    title: {
        margin: "0",
        fontSize: "24px",
        color: "#5d3b00",
    },
    intro: {
        margin: "8px 0 0",
        color: "#6a4a14",
        fontSize: "14px",
    },
    content: {
        padding: "20px 24px",
    },
};
