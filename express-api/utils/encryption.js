/**
 * Encryption utilities for sensitive data (card numbers, etc.)
 */

const CryptoJS = require("crypto-js");

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "your-32-character-encryption-key!";

/**
 * Encrypt sensitive data
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Encrypted text
 */
function encrypt(text) {
	if (!text) return "";
	return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

/**
 * Decrypt sensitive data
 * @param {string} ciphertext - Encrypted text
 * @returns {string} - Decrypted plain text
 */
function decrypt(ciphertext) {
	if (!ciphertext) return "";
	const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
	return bytes.toString(CryptoJS.enc.Utf8);
}

/**
 * Get last 4 digits of card number
 * @param {string} cardNumber - Full card number
 * @returns {string} - Last 4 digits
 */
function getLastFour(cardNumber) {
	if (!cardNumber) return "****";
	const cleaned = cardNumber.replace(/\D/g, "");
	return cleaned.slice(-4);
}

/**
 * Detect card type from number
 * @param {string} cardNumber - Card number
 * @returns {string} - Card type (visa, mastercard, amex, etc.)
 */
function detectCardType(cardNumber) {
	const cleaned = cardNumber.replace(/\D/g, "");

	if (/^4/.test(cleaned)) return "visa";
	if (/^5[1-5]/.test(cleaned)) return "mastercard";
	if (/^3[47]/.test(cleaned)) return "amex";
	if (/^6(?:011|5)/.test(cleaned)) return "discover";
	return "unknown";
}

module.exports = {
	encrypt,
	decrypt,
	getLastFour,
	detectCardType,
};
