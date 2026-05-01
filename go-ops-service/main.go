package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
)

type runtimeConfig struct {
	Port             string
	APIKey           string
	RedisURL         string
	RedisPassword    string
	EventsKey        string
	MaxEvents        int64
	TLSCertFile      string
	TLSKeyFile       string
	TLSClientCAFile  string
	RequireMTLS      bool
	AllowedSPIFFEIDs []string

	RequireServiceAssertion bool
	ServiceAssertionKeyPEM  string
	ServiceAssertionAudience string
	ServiceAssertionIssuers []string
	ServiceAssertionScope   string
}

type serviceAssertionHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

type serviceAssertionClaims struct {
	Iss   string `json:"iss"`
	Sub   string `json:"sub"`
	Aud   any    `json:"aud"`
	Scope string `json:"scope"`
	Iat   int64  `json:"iat"`
	Nbf   int64  `json:"nbf"`
	Exp   int64  `json:"exp"`
	JTI   string `json:"jti"`
}

type serviceAssertionVerifier struct {
	publicKey        ed25519.PublicKey
	expectedAudience string
	allowedIssuers   []string
	requiredScope    string
}

type eventIngestRequest struct {
	EventType string                 `json:"eventType"`
	Source    string                 `json:"source"`
	Payload   map[string]interface{} `json:"payload"`
}

type eventRecord struct {
	EventType  string                 `json:"eventType"`
	Source     string                 `json:"source"`
	Payload    map[string]interface{} `json:"payload"`
	ReceivedAt time.Time              `json:"receivedAt"`
}

type eventStore struct {
	rdb      *redis.Client
	ctx      context.Context
	listKey  string
	maxItems int64
}

func (s *eventStore) add(evt eventRecord) {
	data, err := json.Marshal(evt)
	if err != nil {
		log.Printf("Failed to marshal event: %v", err)
		return
	}

	pipe := s.rdb.Pipeline()
	pipe.LPush(s.ctx, s.listKey, data)
	pipe.LTrim(s.ctx, s.listKey, 0, s.maxItems-1)
	if _, err := pipe.Exec(s.ctx); err != nil {
		log.Printf("Failed to save event to redis: %v", err)
	}
}

func (s *eventStore) list(limit int) []eventRecord {
	if limit < 1 {
		limit = 20
	}
	if limit > int(s.maxItems) {
		limit = int(s.maxItems)
	}

	items, err := s.rdb.LRange(s.ctx, s.listKey, 0, int64(limit-1)).Result()
	if err != nil {
		log.Printf("Failed to fetch events from redis: %v", err)
		return []eventRecord{}
	}

	copyOut := make([]eventRecord, 0, len(items))
	for _, item := range items {
		var evt eventRecord
		if err := json.Unmarshal([]byte(item), &evt); err == nil {
			copyOut = append(copyOut, evt)
		}
	}

	return copyOut
}

func main() {
	cfg := loadConfig()

	assertionVerifier, err := newServiceAssertionVerifier(cfg)
	if err != nil {
		log.Fatalf("service assertion config error: %v", err)
	};

	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisURL,
		Password: cfg.RedisPassword,
	})
	ctx := context.Background()

	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		log.Fatalf("redis connection failed (%s): %v", cfg.RedisURL, err)
	}
	defer func() {
		_ = rdb.Close()
	}()

	store := &eventStore{
		rdb:      rdb,
		ctx:      ctx,
		listKey:  cfg.EventsKey,
		maxItems: cfg.MaxEvents,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		respondJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"service": "go-ops-service",
			"time":    time.Now().UTC().Format(time.RFC3339),
			"tls":     cfg.TLSCertFile != "" && cfg.TLSKeyFile != "",
			"mtls":    cfg.RequireMTLS,
		})
	})

	mux.HandleFunc("/events/ingest", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			respondJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
			return
		}

		if cfg.RequireMTLS {
			if identityErr := requireServiceIdentity(r, cfg.AllowedSPIFFEIDs); identityErr != nil {
				respondJSON(w, http.StatusUnauthorized, map[string]any{"error": identityErr.Error()})
				return
			}
		}

		if assertionVerifier != nil {
			assertionToken := strings.TrimSpace(r.Header.Get("x-service-assertion"))
			if assertionToken == "" {
				if cfg.RequireServiceAssertion {
					respondJSON(w, http.StatusUnauthorized, map[string]any{"error": "service assertion token required"})
					return
				}
			} else {
				if _, verifyErr := assertionVerifier.verify(assertionToken); verifyErr != nil {
					respondJSON(w, http.StatusUnauthorized, map[string]any{"error": verifyErr.Error()})
					return
				}
			}
		}

		if cfg.APIKey != "" {
			headKey := strings.TrimSpace(r.Header.Get("x-ops-key"))
			if headKey == "" || headKey != cfg.APIKey {
				respondJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid ops key"})
				return
			}
		}

		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var payload eventIngestRequest
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&payload); err != nil {
			respondJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
			return
		}
		var extra any
		if err := decoder.Decode(&extra); err != nil && err != io.EOF {
			respondJSON(w, http.StatusBadRequest, map[string]any{"error": "unexpected trailing json"})
			return
		}
		payload.EventType = strings.TrimSpace(payload.EventType)
		if payload.EventType == "" {
			respondJSON(w, http.StatusBadRequest, map[string]any{"error": "eventType is required"})
			return
		}
		payload.Source = strings.TrimSpace(payload.Source)
		if payload.Source == "" {
			payload.Source = "express"
		}

		record := eventRecord{
			EventType:  payload.EventType,
			Source:     payload.Source,
			Payload:    payload.Payload,
			ReceivedAt: time.Now().UTC(),
		}
		store.add(record)

		respondJSON(w, http.StatusAccepted, map[string]any{
			"accepted":  true,
			"eventType": payload.EventType,
			"source":    payload.Source,
		})
	})

	mux.HandleFunc("/events/stats", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			respondJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
			return
		}

		limit := 25
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			if v, err := strconv.Atoi(raw); err == nil {
				limit = v
			}
		}
		respondJSON(w, http.StatusOK, map[string]any{
			"events": store.list(limit),
		})
	})

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           securityHeadersMiddleware(loggingMiddleware(mux)),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	tlsConfig, useTLS, err := buildTLSConfig(cfg)
	if err != nil {
		log.Fatalf("failed to configure TLS: %v", err)
	}
	if useTLS {
		server.TLSConfig = tlsConfig
	}

	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-shutdownCtx.Done()
		ctx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelShutdown()
		if shutdownErr := server.Shutdown(ctx); shutdownErr != nil {
			log.Printf("server shutdown error: %v", shutdownErr)
		}
	}()

	mode := "http"
	if useTLS {
		if cfg.RequireMTLS {
			mode = "https+mtls"
		} else {
			mode = "https"
		}
	}

	log.Printf("go-ops-service listening on :%s (%s)", cfg.Port, mode)
	if useTLS {
		err = server.ListenAndServeTLS("", "")
	} else {
		err = server.ListenAndServe()
	}

	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := strings.TrimSpace(r.Header.Get("x-request-id"))
		if requestID == "" {
			requestID = generateRequestID()
		}
		w.Header().Set("x-request-id", requestID)

		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s request_id=%s", r.Method, r.URL.Path, time.Since(start), requestID)
	})
}

func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Cache-Control", "no-store")
		if r.TLS != nil {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func respondJSON(w http.ResponseWriter, status int, payload map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func envOr(key string, fallback string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v
}

func secretOrEnv(key string) string {
	direct := strings.TrimSpace(os.Getenv(key))
	if direct != "" {
		// If it looks like a path and not a PEM key, try reading it
		if (strings.Contains(direct, "/") || strings.Contains(direct, "\\") || strings.HasPrefix(direct, "./")) &&
			!strings.HasPrefix(direct, "-----BEGIN") {
			if _, err := os.Stat(direct); err == nil {
				bytes, err := os.ReadFile(direct)
				if err == nil {
					return strings.TrimSpace(string(bytes))
				}
			}
		}
		return direct
	}

	filePath := strings.TrimSpace(os.Getenv(key + "_FILE"))
	if filePath == "" {
		return ""
	}

	bytes, err := os.ReadFile(filePath)
	if err != nil {
		log.Printf("warning: failed to read %s_FILE: %v", key, err)
		return ""
	}

	return strings.TrimSpace(string(bytes))
}

func envBool(key string, fallback bool) bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if raw == "" {
		return fallback
	}

	return raw == "1" || raw == "true" || raw == "yes" || raw == "on"
}

func envCSV(key string) []string {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return nil
	}

	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item != "" {
			out = append(out, item)
		}
	}

	return out
}

func loadConfig() runtimeConfig {
	maxEvents := int64(envOrInt("OPS_EVENTS_MAX", 200))
	if maxEvents < 1 {
		maxEvents = 200
	}

	return runtimeConfig{
		Port:             envOr("PORT", "8083"),
		APIKey:           secretOrEnv("OPS_API_KEY"),
		RedisURL:         envOr("REDIS_URL", "localhost:6379"),
		RedisPassword:    secretOrEnv("REDIS_PASSWORD"),
		EventsKey:        envOr("OPS_EVENTS_KEY", "ops:events"),
		MaxEvents:        maxEvents,
		TLSCertFile:      strings.TrimSpace(os.Getenv("GO_OPS_TLS_CERT_FILE")),
		TLSKeyFile:       strings.TrimSpace(os.Getenv("GO_OPS_TLS_KEY_FILE")),
		TLSClientCAFile:  strings.TrimSpace(os.Getenv("GO_OPS_TLS_CLIENT_CA_FILE")),
		RequireMTLS:      envBool("GO_OPS_REQUIRE_MTLS", false),
		AllowedSPIFFEIDs: envCSV("GO_OPS_ALLOWED_SPIFFE_IDS"),

		RequireServiceAssertion: envBool("GO_OPS_REQUIRE_SERVICE_ASSERTION", false),
		ServiceAssertionKeyPEM:  secretOrEnv("SERVICE_ASSERTION_PUBLIC_KEY"),
		ServiceAssertionAudience: envOr("SERVICE_ASSERTION_AUDIENCE", "filspresso-backend"),
		ServiceAssertionIssuers: envCSV("SERVICE_ASSERTION_ISSUER_ALLOWLIST"),
		ServiceAssertionScope:   envOr("GO_OPS_SERVICE_ASSERTION_SCOPE", "service-events:write"),
	}
}

func newServiceAssertionVerifier(cfg runtimeConfig) (*serviceAssertionVerifier, error) {
	if cfg.ServiceAssertionKeyPEM == "" {
		if cfg.RequireServiceAssertion {
			return nil, fmt.Errorf("GO_OPS_REQUIRE_SERVICE_ASSERTION=true requires SERVICE_ASSERTION_PUBLIC_KEY")
		}
		return nil, nil
	}

	publicKey, err := parseEd25519PublicKey(cfg.ServiceAssertionKeyPEM)
	if err != nil {
		return nil, err
	}

	return &serviceAssertionVerifier{
		publicKey:        publicKey,
		expectedAudience: strings.TrimSpace(cfg.ServiceAssertionAudience),
		allowedIssuers:   cfg.ServiceAssertionIssuers,
		requiredScope:    strings.TrimSpace(cfg.ServiceAssertionScope),
	}, nil
}

func parseEd25519PublicKey(publicKeyPEM string) (ed25519.PublicKey, error) {
	block, _ := pem.Decode([]byte(publicKeyPEM))
	if block == nil {
		return nil, fmt.Errorf("failed to parse SERVICE_ASSERTION_PUBLIC_KEY PEM")
	}

	// Try parsing as PKIX
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err == nil {
		if publicKey, ok := parsed.(ed25519.PublicKey); ok {
			return publicKey, nil
		}
		return nil, fmt.Errorf("SERVICE_ASSERTION_PUBLIC_KEY is not Ed25519, got: %T", parsed)
	}

	// If PKIX fails, it might be a raw key
	if len(block.Bytes) == ed25519.PublicKeySize {
		return ed25519.PublicKey(block.Bytes), nil
	}

	return nil, fmt.Errorf("failed to parse SERVICE_ASSERTION_PUBLIC_KEY as PKIX or raw: %w", err)
}

func (v *serviceAssertionVerifier) verify(token string) (*serviceAssertionClaims, error) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("service assertion token format invalid")
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("service assertion header decode failed")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("service assertion payload decode failed")
	}
	signatureBytes, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("service assertion signature decode failed")
	}

	var header serviceAssertionHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, fmt.Errorf("service assertion header parse failed")
	}
	if header.Alg != "EdDSA" {
		return nil, fmt.Errorf("service assertion algorithm invalid")
	}

	signingInput := []byte(parts[0] + "." + parts[1])
	if !ed25519.Verify(v.publicKey, signingInput, signatureBytes) {
		return nil, fmt.Errorf("service assertion signature invalid")
	}

	var claims serviceAssertionClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, fmt.Errorf("service assertion claims parse failed")
	}

	now := time.Now().Unix()
	if claims.Exp == 0 || claims.Exp <= now {
		return nil, fmt.Errorf("service assertion expired")
	}
	if claims.Nbf != 0 && claims.Nbf > now+5 {
		return nil, fmt.Errorf("service assertion not yet valid")
	}

	if v.expectedAudience != "" && !audienceContains(claims.Aud, v.expectedAudience) {
		return nil, fmt.Errorf("service assertion audience mismatch")
	}

	if len(v.allowedIssuers) > 0 && !containsString(v.allowedIssuers, claims.Iss) {
		return nil, fmt.Errorf("service assertion issuer not allowed")
	}

	if v.requiredScope != "" && !scopeContains(claims.Scope, v.requiredScope) {
		return nil, fmt.Errorf("service assertion scope missing")
	}

	return &claims, nil
}

func audienceContains(aud any, expected string) bool {
	if expected == "" {
		return true
	}

	switch typed := aud.(type) {
	case string:
		return typed == expected
	case []any:
		for _, item := range typed {
			if value, ok := item.(string); ok && value == expected {
				return true
			}
		}
	}

	return false
}

func scopeContains(scopesRaw string, expected string) bool {
	if expected == "" {
		return true
	}

	for _, scope := range strings.Fields(scopesRaw) {
		if scope == expected {
			return true
		}
	}

	return false
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func buildTLSConfig(cfg runtimeConfig) (*tls.Config, bool, error) {
	if cfg.TLSCertFile == "" || cfg.TLSKeyFile == "" {
		if cfg.RequireMTLS {
			return nil, false, fmt.Errorf("GO_OPS_REQUIRE_MTLS=true requires GO_OPS_TLS_CERT_FILE and GO_OPS_TLS_KEY_FILE")
		}
		return nil, false, nil
	}

	certificate, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
	if err != nil {
		return nil, false, fmt.Errorf("failed to load server certificate pair: %w", err)
	}

	tlsConfig := &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
	}

	if cfg.RequireMTLS || cfg.TLSClientCAFile != "" {
		if cfg.TLSClientCAFile == "" {
			return nil, false, fmt.Errorf("GO_OPS_REQUIRE_MTLS=true requires GO_OPS_TLS_CLIENT_CA_FILE")
		}

		caBytes, readErr := os.ReadFile(cfg.TLSClientCAFile)
		if readErr != nil {
			return nil, false, fmt.Errorf("failed to read client CA file: %w", readErr)
		}

		clientCAPool := x509.NewCertPool()
		if ok := clientCAPool.AppendCertsFromPEM(caBytes); !ok {
			return nil, false, fmt.Errorf("failed to parse client CA file")
		}

		tlsConfig.ClientCAs = clientCAPool
		// Keep health endpoints reachable while enforcing mTLS identity in sensitive handlers.
		tlsConfig.ClientAuth = tls.VerifyClientCertIfGiven
	}

	return tlsConfig, true, nil
}

func requireServiceIdentity(r *http.Request, allowedSPIFFEIDs []string) error {
	if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
		return fmt.Errorf("mTLS client certificate required")
	}

	leaf := r.TLS.PeerCertificates[0]
	identities := make([]string, 0, len(leaf.URIs))
	for _, uri := range leaf.URIs {
		if uri != nil {
			identities = append(identities, uri.String())
		}
	}

	if len(identities) == 0 {
		return fmt.Errorf("client certificate missing SPIFFE identity")
	}

	if len(allowedSPIFFEIDs) == 0 {
		for _, id := range identities {
			if strings.HasPrefix(id, "spiffe://") {
				return nil
			}
		}
		return fmt.Errorf("client identity is not a SPIFFE URI")
	}

	for _, identity := range identities {
		for _, allowed := range allowedSPIFFEIDs {
			if identity == allowed {
				return nil
			}
		}
	}

	return fmt.Errorf("client SPIFFE identity not allowed")
}

func generateRequestID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("req-%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("req-%x", buf)
}

func envOrInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return parsed
}
