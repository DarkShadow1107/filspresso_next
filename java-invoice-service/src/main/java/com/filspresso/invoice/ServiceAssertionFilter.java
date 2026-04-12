package com.filspresso.invoice;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class ServiceAssertionFilter extends OncePerRequestFilter {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private final boolean serviceAssertionRequired;
    private final String expectedScope;
    private final String expectedAudience;
    private final Set<String> issuerAllowlist;
    private final PublicKey serviceAssertionPublicKey;
    private final String publicKeyError;

    public ServiceAssertionFilter() {
        this.serviceAssertionRequired = parseBooleanEnv("SERVICE_ASSERTION_REQUIRED", false);
        this.expectedScope = envOr("SERVICE_ASSERTION_SCOPE", "service-invoice:render");
        this.expectedAudience = envOr("SERVICE_ASSERTION_AUDIENCE", "filspresso-backend");
        this.issuerAllowlist = parseCsvEnv("SERVICE_ASSERTION_ISSUER_ALLOWLIST");

        PublicKey parsedPublicKey = null;
        String keyError = "";
        String publicKeyPem = envOrFile("SERVICE_ASSERTION_PUBLIC_KEY");
        if (!publicKeyPem.isBlank()) {
            try {
                parsedPublicKey = parseEd25519PublicKey(publicKeyPem);
            } catch (Exception ex) {
                keyError = "service assertion public key is malformed";
            }
        }

        this.serviceAssertionPublicKey = parsedPublicKey;
        this.publicKeyError = keyError;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        if (path == null || path.isBlank()) {
            return true;
        }

        if (!path.startsWith("/api/invoices/")) {
            return true;
        }

        return path.equals("/api/invoices/health");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        String assertionToken = extractAssertionToken(request);
        if (assertionToken.isBlank()) {
            if (!serviceAssertionRequired) {
                filterChain.doFilter(request, response);
                return;
            }

            writeJsonError(response, 401, "Missing service assertion", "missing_assertion");
            return;
        }

        VerificationResult verification = verifyAssertion(assertionToken);
        if (!verification.ok()) {
            if (!serviceAssertionRequired && isVerifierUnavailableReason(verification.reason())) {
                filterChain.doFilter(request, response);
                return;
            }

            writeJsonError(response, verification.status(), verification.message(), verification.reason());
            return;
        }

        filterChain.doFilter(request, response);
    }

    private VerificationResult verifyAssertion(String token) {
        if (serviceAssertionPublicKey == null) {
            String reason = publicKeyError.isBlank() ? "service assertion public key is not configured" : publicKeyError;
            return VerificationResult.failure(503, "Service assertion verification unavailable", reason);
        }

        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_format_invalid");
        }

        byte[] headerBytes = decodeBase64Url(parts[0]);
        byte[] payloadBytes = decodeBase64Url(parts[1]);
        byte[] signatureBytes = decodeBase64Url(parts[2]);
        if (headerBytes == null || payloadBytes == null || signatureBytes == null || signatureBytes.length == 0) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_payload_invalid");
        }

        Map<String, Object> header = parseJsonMap(headerBytes);
        Map<String, Object> payload = parseJsonMap(payloadBytes);
        if (header == null || payload == null) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_json_invalid");
        }

        String alg = asString(header.get("alg"));
        if (!"EdDSA".equals(alg)) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_alg_invalid");
        }

        try {
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(serviceAssertionPublicKey);
            verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.UTF_8));
            if (!verifier.verify(signatureBytes)) {
                return VerificationResult.failure(401, "Invalid service assertion", "signature_verification_failed");
            }
        } catch (Exception ex) {
            return VerificationResult.failure(503, "Service assertion verification unavailable", "signature_verifier_error");
        }

        long now = Instant.now().getEpochSecond();
        Long exp = asLong(payload.get("exp"));
        if (exp == null || exp <= now) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_expired");
        }

        Long nbf = asLong(payload.get("nbf"));
        if (nbf == null) {
            nbf = asLong(payload.get("iat"));
        }
        if (nbf != null && nbf > now + 5) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_not_yet_valid");
        }

        if (!audienceMatches(payload.get("aud"))) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_audience_mismatch");
        }

        if (!issuerMatches(payload.get("iss"))) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_issuer_not_allowed");
        }

        if (!scopeMatches(payload.get("scope"))) {
            return VerificationResult.failure(401, "Invalid service assertion", "token_scope_invalid");
        }

        return VerificationResult.success();
    }

    private boolean isVerifierUnavailableReason(String reason) {
        String normalized = safeTrim(reason);
        return normalized.equals("service assertion public key is not configured")
                || normalized.equals("service assertion public key is malformed")
                || normalized.equals("signature_verifier_error");
    }

    private boolean audienceMatches(Object audClaim) {
        if (expectedAudience.isBlank()) {
            return true;
        }

        if (audClaim instanceof String audString) {
            return expectedAudience.equals(audString.trim());
        }

        if (audClaim instanceof Iterable<?> iterable) {
            for (Object candidate : iterable) {
                if (expectedAudience.equals(asString(candidate))) {
                    return true;
                }
            }
            return false;
        }

        return false;
    }

    private boolean issuerMatches(Object issClaim) {
        if (issuerAllowlist.isEmpty()) {
            return true;
        }

        String issuer = asString(issClaim);
        return issuerAllowlist.contains(issuer);
    }

    private boolean scopeMatches(Object scopeClaim) {
        if (expectedScope.isBlank()) {
            return true;
        }

        String scope = asString(scopeClaim);
        if (scope.isBlank()) {
            return false;
        }

        return Arrays.stream(scope.split("\\s+"))
                .map(String::trim)
                .filter(entry -> !entry.isBlank())
                .anyMatch(expectedScope::equals);
    }

    private String extractAssertionToken(HttpServletRequest request) {
        String headerAssertion = safeTrim(request.getHeader("x-service-assertion"));
        if (!headerAssertion.isBlank()) {
            return headerAssertion;
        }

        String authorization = safeTrim(request.getHeader("Authorization"));
        if (authorization.length() > 10 && authorization.regionMatches(true, 0, "Assertion ", 0, 10)) {
            return authorization.substring(10).trim();
        }

        return "";
    }

    private void writeJsonError(HttpServletResponse response, int status, String error, String reason) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());

        Map<String, String> body = new LinkedHashMap<>();
        body.put("error", error);
        body.put("reason", reason);
        response.getWriter().write(OBJECT_MAPPER.writeValueAsString(body));
    }

    private static String envOr(String name, String fallback) {
        String value = safeTrim(System.getenv(name));
        return value.isBlank() ? fallback : value;
    }

    private static String envOrFile(String name) {
        String direct = safeTrim(System.getenv(name));
        if (!direct.isBlank()) {
            return direct;
        }

        String filePath = safeTrim(System.getenv(name + "_FILE"));
        if (filePath.isBlank()) {
            return "";
        }

        try {
            return Files.readString(Path.of(filePath), StandardCharsets.UTF_8).trim();
        } catch (Exception ignored) {
            return "";
        }
    }

    private static Set<String> parseCsvEnv(String name) {
        String raw = safeTrim(System.getenv(name));
        if (raw.isBlank()) {
            return Collections.emptySet();
        }

        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(entry -> !entry.isBlank())
                .collect(Collectors.toSet());
    }

    private static boolean parseBooleanEnv(String name, boolean fallback) {
        String raw = safeTrim(System.getenv(name));
        if (raw.isBlank()) {
            return fallback;
        }
        return "true".equalsIgnoreCase(raw);
    }

    private static PublicKey parseEd25519PublicKey(String pem) throws Exception {
        String normalized = pem
                .replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .replaceAll("\\s+", "");

        byte[] keyBytes = Base64.getDecoder().decode(normalized);
        X509EncodedKeySpec keySpec = new X509EncodedKeySpec(keyBytes);
        return KeyFactory.getInstance("Ed25519").generatePublic(keySpec);
    }

    private static byte[] decodeBase64Url(String part) {
        try {
            return Base64.getUrlDecoder().decode(part);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static Map<String, Object> parseJsonMap(byte[] jsonBytes) {
        try {
            return OBJECT_MAPPER.readValue(jsonBytes, new TypeReference<Map<String, Object>>() {
            });
        } catch (Exception ignored) {
            return null;
        }
    }

    private static Long asLong(Object raw) {
        if (raw instanceof Number number) {
            return number.longValue();
        }

        if (raw instanceof String rawString) {
            try {
                return Long.parseLong(rawString.trim());
            } catch (NumberFormatException ignored) {
                return null;
            }
        }

        return null;
    }

    private static String asString(Object raw) {
        return raw == null ? "" : raw.toString().trim();
    }

    private static String safeTrim(String value) {
        return value == null ? "" : value.trim();
    }

    private record VerificationResult(boolean ok, int status, String message, String reason) {
        static VerificationResult success() {
            return new VerificationResult(true, 200, "", "");
        }

        static VerificationResult failure(int status, String message, String reason) {
            return new VerificationResult(false, status, message, reason);
        }
    }
}
