package com.filspresso.subscriptions

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.Base64

@Component
class ServiceAssertionFilter : OncePerRequestFilter() {
    private val objectMapper = jacksonObjectMapper()

    private val serviceAssertionRequired = parseBooleanEnv("SERVICE_ASSERTION_REQUIRED", false)
    private val expectedScope = envOr("SERVICE_ASSERTION_SCOPE", "service-subscriptions:quote")
    private val expectedAudience = envOr("SERVICE_ASSERTION_AUDIENCE", "filspresso-backend")
    private val issuerAllowlist = parseCsvEnv("SERVICE_ASSERTION_ISSUER_ALLOWLIST")
    private val serviceAssertionPublicKey = loadPublicKeyConfig()

    override fun shouldNotFilter(request: HttpServletRequest): Boolean {
        val path = request.requestURI ?: return true
        if (!path.startsWith("/api/subscriptions/")) {
            return true
        }
        return path == "/api/subscriptions/health"
    }

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val assertionToken = extractAssertionToken(request)
        if (assertionToken.isBlank()) {
            if (!serviceAssertionRequired) {
                filterChain.doFilter(request, response)
                return
            }

            writeJsonError(response, 401, "Missing service assertion", "missing_assertion")
            return
        }

        val verification = verifyAssertion(assertionToken)
        if (!verification.ok) {
            if (!serviceAssertionRequired && isVerifierUnavailableReason(verification.reason)) {
                filterChain.doFilter(request, response)
                return
            }

            writeJsonError(response, verification.status, verification.message, verification.reason)
            return
        }

        filterChain.doFilter(request, response)
    }

    private fun verifyAssertion(token: String): VerificationResult {
        if (serviceAssertionPublicKey.key == null) {
            val reason = if (serviceAssertionPublicKey.error.isBlank()) {
                "service assertion public key is not configured"
            } else {
                serviceAssertionPublicKey.error
            }
            return VerificationResult.failure(503, "Service assertion verification unavailable", reason)
        }

        val parts = token.split(".")
        if (parts.size != 3) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_format_invalid")
        }

        val headerBytes = decodeBase64Url(parts[0])
        val payloadBytes = decodeBase64Url(parts[1])
        val signatureBytes = decodeBase64Url(parts[2])
        if (headerBytes == null || payloadBytes == null || signatureBytes == null || signatureBytes.isEmpty()) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_payload_invalid")
        }

        val header = parseJsonMap(headerBytes)
        val payload = parseJsonMap(payloadBytes)
        if (header == null || payload == null) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_json_invalid")
        }

        if (header["alg"]?.toString()?.trim() != "EdDSA") {
            return VerificationResult.failure(401, "Invalid service assertion", "token_alg_invalid")
        }

        try {
            val verifier = Signature.getInstance("Ed25519")
            verifier.initVerify(serviceAssertionPublicKey.key)
            verifier.update("${parts[0]}.${parts[1]}".toByteArray(StandardCharsets.UTF_8))
            if (!verifier.verify(signatureBytes)) {
                return VerificationResult.failure(401, "Invalid service assertion", "signature_verification_failed")
            }
        } catch (_: Exception) {
            return VerificationResult.failure(503, "Service assertion verification unavailable", "signature_verifier_error")
        }

        val now = Instant.now().epochSecond
        val exp = asLong(payload["exp"])
        if (exp == null || exp <= now) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_expired")
        }

        val nbf = asLong(payload["nbf"]) ?: asLong(payload["iat"])
        if (nbf != null && nbf > now + 5) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_not_yet_valid")
        }

        if (!audienceMatches(payload["aud"])) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_audience_mismatch")
        }

        if (!issuerMatches(payload["iss"])) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_issuer_not_allowed")
        }

        if (!scopeMatches(payload["scope"])) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_scope_invalid")
        }

        return VerificationResult.success()
    }

    private fun isVerifierUnavailableReason(reason: String): Boolean {
        val normalized = reason.trim()
        return normalized == "service assertion public key is not configured" ||
            normalized == "service assertion public key is malformed" ||
            normalized == "signature_verifier_error"
    }

    private fun extractAssertionToken(request: HttpServletRequest): String {
        val headerAssertion = request.getHeader("x-service-assertion")?.trim().orEmpty()
        if (headerAssertion.isNotBlank()) {
            return headerAssertion
        }

        val authorization = request.getHeader("Authorization")?.trim().orEmpty()
        if (authorization.length > 10 && authorization.regionMatches(0, "Assertion ", 0, 10, ignoreCase = true)) {
            return authorization.substring(10).trim()
        }

        return ""
    }

    private fun audienceMatches(audClaim: Any?): Boolean {
        if (expectedAudience.isBlank()) {
            return true
        }

        return when (audClaim) {
            is String -> expectedAudience == audClaim.trim()
            is Collection<*> -> audClaim.any { expectedAudience == it?.toString()?.trim().orEmpty() }
            else -> false
        }
    }

    private fun issuerMatches(issClaim: Any?): Boolean {
        if (issuerAllowlist.isEmpty()) {
            return true
        }

        val issuer = issClaim?.toString()?.trim().orEmpty()
        return issuerAllowlist.contains(issuer)
    }

    private fun scopeMatches(scopeClaim: Any?): Boolean {
        if (expectedScope.isBlank()) {
            return true
        }

        val scope = scopeClaim?.toString()?.trim().orEmpty()
        if (scope.isBlank()) {
            return false
        }

        return scope
            .split(Regex("\\s+"))
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .any { it == expectedScope }
    }

    private fun writeJsonError(response: HttpServletResponse, status: Int, error: String, reason: String) {
        response.status = status
        response.contentType = "application/json"
        response.characterEncoding = StandardCharsets.UTF_8.name()

        val payload = linkedMapOf(
            "error" to error,
            "reason" to reason,
        )

        response.writer.write(objectMapper.writeValueAsString(payload))
    }

    private fun loadPublicKeyConfig(): PublicKeyConfig {
        val publicKeyPem = envOrFile("SERVICE_ASSERTION_PUBLIC_KEY")
        if (publicKeyPem.isBlank()) {
            return PublicKeyConfig(null, "")
        }

        return try {
            PublicKeyConfig(parseEd25519PublicKey(publicKeyPem), "")
        } catch (_: Exception) {
            PublicKeyConfig(null, "service assertion public key is malformed")
        }
    }

    private fun parseEd25519PublicKey(pem: String): PublicKey {
        val normalized = pem
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replace(Regex("\\s+"), "")

        val keyBytes = Base64.getDecoder().decode(normalized)
        val keySpec = X509EncodedKeySpec(keyBytes)
        return KeyFactory.getInstance("Ed25519").generatePublic(keySpec)
    }

    private fun decodeBase64Url(part: String): ByteArray? {
        return try {
            Base64.getUrlDecoder().decode(part)
        } catch (_: Exception) {
            null
        }
    }

    private fun parseJsonMap(jsonBytes: ByteArray): Map<String, Any?>? {
        return try {
            objectMapper.readValue(jsonBytes, object : TypeReference<Map<String, Any?>>() {})
        } catch (_: Exception) {
            null
        }
    }

    private fun asLong(raw: Any?): Long? {
        return when (raw) {
            is Number -> raw.toLong()
            is String -> raw.trim().toLongOrNull()
            else -> null
        }
    }

    private fun envOr(name: String, fallback: String): String {
        val value = System.getenv(name)?.trim().orEmpty()
        return if (value.isBlank()) fallback else value
    }

    private fun envOrFile(name: String): String {
        val direct = System.getenv(name)?.trim().orEmpty()
        if (direct.isNotBlank()) {
            // If it looks like a path and not a PEM key, try reading it
            if ((direct.contains("/") || direct.contains("\\") || direct.startsWith("./")) &&
                !direct.startsWith("-----BEGIN")) {
                try {
                    val path = Path.of(direct)
                    if (Files.exists(path)) {
                        return Files.readString(path, StandardCharsets.UTF_8).trim()
                    }
                } catch (_: Exception) {
                }
            }
            return direct
        }

        val path = System.getenv("${name}_FILE")?.trim().orEmpty()
        if (path.isBlank()) {
            return ""
        }

        return try {
            Files.readString(Path.of(path), StandardCharsets.UTF_8).trim()
        } catch (_: Exception) {
            ""
        }
    }

    private fun parseCsvEnv(name: String): Set<String> {
        val raw = System.getenv(name)?.trim().orEmpty()
        if (raw.isBlank()) {
            return emptySet()
        }

        return raw.split(",")
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .toSet()
    }

    private fun parseBooleanEnv(name: String, fallback: Boolean): Boolean {
        val raw = System.getenv(name)?.trim().orEmpty()
        if (raw.isBlank()) {
            return fallback
        }
        return raw.equals("true", ignoreCase = true)
    }

    private data class PublicKeyConfig(
        val key: PublicKey?,
        val error: String,
    )

    private data class VerificationResult(
        val ok: Boolean,
        val status: Int,
        val message: String,
        val reason: String,
    ) {
        companion object {
            fun success() = VerificationResult(true, 200, "", "")

            fun failure(status: Int, message: String, reason: String) =
                VerificationResult(false, status, message, reason)
        }
    }
}
