package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

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
	port := envOr("PORT", "8083")
	apiKey := strings.TrimSpace(os.Getenv("OPS_API_KEY"))
	redisURL := envOr("REDIS_URL", "localhost:6379")
	redisPassword := strings.TrimSpace(os.Getenv("REDIS_PASSWORD"))
	maxEvents := int64(envOrInt("OPS_EVENTS_MAX", 200))
	if maxEvents < 1 {
		maxEvents = 200
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:     redisURL,
		Password: redisPassword,
	})
	ctx := context.Background()

	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		log.Fatalf("redis connection failed (%s): %v", redisURL, err)
	}
	defer func() {
		_ = rdb.Close()
	}()

	store := &eventStore{
		rdb:      rdb,
		ctx:      ctx,
		listKey:  envOr("OPS_EVENTS_KEY", "ops:events"),
		maxItems: maxEvents,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		respondJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"service": "go-ops-service",
			"time":    time.Now().UTC().Format(time.RFC3339),
		})
	})

	mux.HandleFunc("/events/ingest", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			respondJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
			return
		}
		if apiKey != "" {
			headKey := strings.TrimSpace(r.Header.Get("x-ops-key"))
			if headKey == "" || headKey != apiKey {
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
		Addr:              ":" + port,
		Handler:           loggingMiddleware(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("go-ops-service listening on :%s", port)
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
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
