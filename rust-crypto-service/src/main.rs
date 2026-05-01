use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha3::{Digest, Sha3_256};
use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tower::ServiceBuilder;
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    timeout::TimeoutLayer,
    trace::TraceLayer,
};

#[derive(Clone)]
struct AppState {
    max_domain_len: usize,
    service_assertion: ServiceAssertionConfig,
}

#[derive(Clone)]
struct ServiceAssertionConfig {
    required: bool,
    scope_commitment: String,
    scope_verify: String,
    expected_audience: String,
    issuer_allowlist: HashSet<String>,
    decoding_key: Option<Arc<DecodingKey>>,
    key_error: String,
    enforce_replay: bool,
    replay_ttl_seconds: i64,
    replay_cache: Arc<Mutex<HashMap<String, i64>>>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    algorithm: &'static str,
}

#[derive(Deserialize)]
struct CommitmentRequest {
    domain: String,
    payload: Option<String>,
    payload_json: Option<Value>,
    operation_id: Option<String>,
}

#[derive(Serialize)]
struct CommitmentResponse {
    algorithm: &'static str,
    domain: String,
    canonical_payload: String,
    commitment_sha3_256: String,
    operation_id: Option<String>,
}

#[derive(Deserialize)]
struct VerifyRequest {
    domain: String,
    payload: Option<String>,
    payload_json: Option<Value>,
    commitment_sha3_256: String,
    operation_id: Option<String>,
}

#[derive(Serialize)]
struct VerifyResponse {
    valid: bool,
    expected_commitment_sha3_256: String,
    operation_id: Option<String>,
}

#[tokio::main]
async fn main() {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8090);

    let max_body = std::env::var("RUST_CRYPTO_MAX_BODY_BYTES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(65_536);

    let state = Arc::new(AppState {
        max_domain_len: 128,
        service_assertion: load_service_assertion_config(),
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/commitment/sha3-256", post(commitment))
        .route("/v1/verify/sha3-256", post(verify_commitment))
        .with_state(state)
        .layer(DefaultBodyLimit::max(max_body))
        .layer(
            ServiceBuilder::new()
                .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
                .layer(PropagateRequestIdLayer::x_request_id())
                .layer(TraceLayer::new_for_http())
                .layer(TimeoutLayer::new(Duration::from_secs(5))),
        );

    let address = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("Failed to bind Rust crypto service");

    println!("rust-crypto-service listening on {}", address);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("Rust crypto service failed");
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "rust-crypto-service",
        algorithm: "sha3-256",
    })
}

async fn commitment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CommitmentRequest>,
) -> Result<Json<CommitmentResponse>, (StatusCode, Json<Value>)> {
    verify_inbound_service_assertion(&state.service_assertion, &headers, &state.service_assertion.scope_commitment)?;

    let domain = request.domain.trim().to_string();
    if domain.is_empty() || domain.len() > state.max_domain_len {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "domain is required and must be <= 128 characters" })),
        ));
    }

    let canonical_payload = canonical_payload(&request.payload, &request.payload_json).map_err(|message| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": message })),
        )
    })?;

    let operation_id = extract_operation_id(&headers, request.operation_id.as_deref())?;
    let commitment = compute_commitment(&domain, &canonical_payload);
    Ok(Json(CommitmentResponse {
        algorithm: "sha3-256",
        domain,
        canonical_payload,
        commitment_sha3_256: commitment,
        operation_id,
    }))
}

async fn verify_commitment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, (StatusCode, Json<Value>)> {
    verify_inbound_service_assertion(&state.service_assertion, &headers, &state.service_assertion.scope_verify)?;

    let domain = request.domain.trim().to_string();
    if domain.is_empty() || domain.len() > state.max_domain_len {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "domain is required and must be <= 128 characters" })),
        ));
    }

    let canonical_payload = canonical_payload(&request.payload, &request.payload_json).map_err(|message| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": message })),
        )
    })?;

    let operation_id = extract_operation_id(&headers, request.operation_id.as_deref())?;
    let expected = compute_commitment(&domain, &canonical_payload);
    Ok(Json(VerifyResponse {
        valid: expected == request.commitment_sha3_256.trim().to_lowercase(),
        expected_commitment_sha3_256: expected,
        operation_id,
    }))
}

fn load_service_assertion_config() -> ServiceAssertionConfig {
    let required = parse_boolean_env("SERVICE_ASSERTION_REQUIRED", false);
    let scope_commitment = env_or(
        "SERVICE_ASSERTION_SCOPE_COMMITMENT",
        &env_or("SERVICE_ASSERTION_SCOPE", "service-crypto:commitment"),
    );
    let scope_verify = env_or(
        "SERVICE_ASSERTION_SCOPE_VERIFY",
        &env_or("SERVICE_ASSERTION_SCOPE", "service-crypto:verify"),
    );
    let expected_audience = env_or("SERVICE_ASSERTION_AUDIENCE", "filspresso-backend");
    let issuer_allowlist = parse_csv_env("SERVICE_ASSERTION_ISSUER_ALLOWLIST");
    let enforce_replay = parse_boolean_env("SERVICE_ASSERTION_ENFORCE_REPLAY", true);
    let replay_ttl_seconds = std::env::var("SERVICE_ASSERTION_REPLAY_TTL_SECONDS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .map(|value| value.clamp(60, 86_400))
        .unwrap_or(900);

    let mut decoding_key = None;
    let mut key_error = String::new();
    let public_key_pem = env_or_file("SERVICE_ASSERTION_PUBLIC_KEY");
    if !public_key_pem.is_empty() {
        match DecodingKey::from_ed_pem(public_key_pem.as_bytes()) {
            Ok(key) => {
                decoding_key = Some(Arc::new(key));
            }
            Err(_) => {
                key_error = "service assertion public key is malformed".to_string();
            }
        }
    }

    ServiceAssertionConfig {
        required,
        scope_commitment,
        scope_verify,
        expected_audience,
        issuer_allowlist,
        decoding_key,
        key_error,
        enforce_replay,
        replay_ttl_seconds,
        replay_cache: Arc::new(Mutex::new(HashMap::new())),
    }
}

fn verify_inbound_service_assertion(
    config: &ServiceAssertionConfig,
    headers: &HeaderMap,
    expected_scope: &str,
) -> Result<(), (StatusCode, Json<Value>)> {
    let token = extract_assertion_token(headers);
    if token.is_empty() {
        if !config.required {
            return Ok(());
        }

        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "Missing service assertion",
            "missing_assertion",
        ));
    }

    let decoding_key = match &config.decoding_key {
        Some(key) => key,
        None => {
            if !config.required {
                return Ok(());
            }

            let reason = if config.key_error.is_empty() {
                "service assertion public key is not configured"
            } else {
                config.key_error.as_str()
            };

            return Err(error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "Service assertion verification unavailable",
                reason,
            ));
        }
    };

    let mut validation = Validation::new(Algorithm::EdDSA);
    validation.validate_exp = false;
    validation.validate_nbf = false;
    validation.required_spec_claims.clear();

    let decoded = decode::<Value>(&token, decoding_key, &validation).map_err(|_| {
        error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid service assertion",
            "token_invalid",
        )
    })?;

    let claims = decoded.claims.as_object().ok_or_else(|| {
        error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid service assertion",
            "token_payload_invalid",
        )
    })?;

    let now = now_epoch_seconds();
    let exp = claims.get("exp").and_then(as_i64).unwrap_or(0);
    if exp <= now {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid service assertion",
            "token_expired",
        ));
    }

    let nbf = claims
        .get("nbf")
        .and_then(as_i64)
        .or_else(|| claims.get("iat").and_then(as_i64))
        .unwrap_or(0);
    if nbf > now + 5 {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid service assertion",
            "token_not_yet_valid",
        ));
    }

    if !audience_matches(claims.get("aud"), &config.expected_audience) {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid service assertion",
            "token_audience_mismatch",
        ));
    }

    if !issuer_matches(claims.get("iss"), &config.issuer_allowlist) {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid service assertion",
            "token_issuer_not_allowed",
        ));
    }

    if !scope_matches(claims.get("scope"), expected_scope) {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid service assertion",
            "token_scope_invalid",
        ));
    }

    if !operation_id_matches(headers, claims.get("op_id")) {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid service assertion",
            "token_operation_id_mismatch",
        ));
    }

    if config.enforce_replay {
        let jti = claims
            .get("jti")
            .and_then(|value| value.as_str())
            .map(|value| value.trim())
            .unwrap_or("");
        if jti.is_empty() {
            return Err(error_response(
                StatusCode::UNAUTHORIZED,
                "Invalid service assertion",
                "token_jti_missing",
            ));
        }

        if !reserve_assertion_jti(config, jti, exp) {
            return Err(error_response(
                StatusCode::CONFLICT,
                "Invalid service assertion",
                "token_replay_detected",
            ));
        }
    }

    Ok(())
}

fn reserve_assertion_jti(config: &ServiceAssertionConfig, jti: &str, exp: i64) -> bool {
    let now = now_epoch_seconds();
    let mut replay_cache = match config.replay_cache.lock() {
        Ok(cache) => cache,
        Err(_) => return false,
    };

    replay_cache.retain(|_, expiry| *expiry > now);
    if let Some(existing_expiry) = replay_cache.get(jti) {
        if *existing_expiry > now {
            return false;
        }
    }

    let expiry = if exp > now {
        exp
    } else {
        now + config.replay_ttl_seconds
    };
    replay_cache.insert(jti.to_string(), expiry);
    true
}

fn extract_assertion_token(headers: &HeaderMap) -> String {
    let header_assertion = header_value(headers, "x-service-assertion");
    if !header_assertion.is_empty() {
        return header_assertion;
    }

    let authorization = header_value(headers, "authorization");
    if authorization.to_ascii_lowercase().starts_with("assertion ") {
        return authorization[10..].trim().to_string();
    }

    String::new()
}

fn extract_operation_id(
    headers: &HeaderMap,
    operation_id_from_body: Option<&str>,
) -> Result<Option<String>, (StatusCode, Json<Value>)> {
    if let Some(value) = operation_id_from_body {
        if value.trim().is_empty() {
            return Ok(None);
        }

        return normalize_operation_id(Some(value))
            .map(Some)
            .ok_or_else(|| {
                error_response(
                    StatusCode::BAD_REQUEST,
                    "Invalid operation id",
                    "operation_id_format_invalid",
                )
            });
    }

    Ok(normalize_operation_id(Some(&header_value(
        headers,
        "x-operation-id",
    ))))
}

fn operation_id_matches(headers: &HeaderMap, claim_value: Option<&Value>) -> bool {
    let claim_operation_id = claim_value
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .unwrap_or("");
    if claim_operation_id.is_empty() {
        return true;
    }

    let header_operation_id = header_value(headers, "x-operation-id");
    if header_operation_id.is_empty() {
        return false;
    }

    header_operation_id == claim_operation_id
}

fn normalize_operation_id(value: Option<&str>) -> Option<String> {
    let text = value.unwrap_or("").trim();
    if text.is_empty() {
        return None;
    }

    if text.len() < 12 || text.len() > 128 {
        return None;
    }

    if !text
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == ':' || character == '_' || character == '-')
    {
        return None;
    }

    Some(text.to_string())
}

fn audience_matches(audience_claim: Option<&Value>, expected_audience: &str) -> bool {
    if expected_audience.trim().is_empty() {
        return true;
    }

    match audience_claim {
        Some(Value::String(value)) => value.trim() == expected_audience,
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|entry| entry.as_str())
            .any(|entry| entry.trim() == expected_audience),
        _ => false,
    }
}

fn issuer_matches(issuer_claim: Option<&Value>, allowlist: &HashSet<String>) -> bool {
    if allowlist.is_empty() {
        return true;
    }

    let issuer = issuer_claim
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .unwrap_or("");
    allowlist.contains(issuer)
}

fn scope_matches(scope_claim: Option<&Value>, expected_scope: &str) -> bool {
    if expected_scope.trim().is_empty() {
        return true;
    }

    let scope = scope_claim
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .unwrap_or("");
    if scope.is_empty() {
        return false;
    }

    scope
        .split_whitespace()
        .any(|entry| entry.trim() == expected_scope)
}

fn as_i64(value: &Value) -> Option<i64> {
    if let Some(number) = value.as_i64() {
        return Some(number);
    }

    value
        .as_str()
        .and_then(|entry| entry.trim().parse::<i64>().ok())
}

fn now_epoch_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn header_value(headers: &HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn parse_boolean_env(name: &str, default: bool) -> bool {
    let value = std::env::var(name).unwrap_or_default();
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return default;
    }

    normalized == "true"
}

fn parse_csv_env(name: &str) -> HashSet<String> {
    std::env::var(name)
        .unwrap_or_default()
        .split(',')
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn env_or(name: &str, default: &str) -> String {
    let value = std::env::var(name).unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        default.to_string()
    } else {
        trimmed.to_string()
    }
}

fn env_or_file(name: &str) -> String {
    let direct = std::env::var(name).unwrap_or_default();
    let trimmed = direct.trim();
    if !trimmed.is_empty() {
        // If it looks like a path and not a PEM key, try reading it
        if (trimmed.contains('/') || trimmed.contains('\\') || trimmed.starts_with("./")) &&
            !trimmed.starts_with("-----BEGIN") {
            if let Ok(content) = std::fs::read_to_string(trimmed) {
                return content.trim().to_string();
            }
        }
        return trimmed.to_string();
    }

    let file_path = std::env::var(format!("{name}_FILE")).unwrap_or_default();
    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return String::new();
    }

    std::fs::read_to_string(trimmed_path)
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn error_response(status: StatusCode, message: &str, reason: &str) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(json!({
            "error": message,
            "reason": reason,
        })),
    )
}

fn canonical_payload(payload: &Option<String>, payload_json: &Option<Value>) -> Result<String, String> {
    if let Some(json_value) = payload_json {
        let canonical = canonicalize_json(json_value.clone());
        return serde_json::to_string(&canonical).map_err(|_| "failed to serialize canonical JSON".to_string());
    }

    let text = payload.clone().unwrap_or_default();
    if text.is_empty() {
        return Err("payload or payload_json is required".to_string());
    }

    Ok(text)
}

fn canonicalize_json(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<String> = map.keys().cloned().collect();
            keys.sort();

            let mut ordered = Map::new();
            for key in keys {
                if let Some(entry) = map.get(&key) {
                    ordered.insert(key, canonicalize_json(entry.clone()));
                }
            }
            Value::Object(ordered)
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(canonicalize_json).collect()),
        other => other,
    }
}

fn compute_commitment(domain: &str, payload: &str) -> String {
    let material = format!("{}|{}", domain, payload);
    let mut hasher = Sha3_256::new();
    hasher.update(material.as_bytes());
    hex::encode(hasher.finalize())
}
