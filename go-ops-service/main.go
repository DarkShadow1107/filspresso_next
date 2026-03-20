package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
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
	mu     sync.RWMutex
	events []eventRecord
}

func (s *eventStore) add(evt eventRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append([]eventRecord{evt}, s.events...)
	if len(s.events) > 200 {
		s.events = s.events[:200]
	}
}

func (s *eventStore) list(limit int) []eventRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit < 1 {
		limit = 20
	}
	if limit > len(s.events) {
		limit = len(s.events)
	}
	copyOut := make([]eventRecord, limit)
	copy(copyOut, s.events[:limit])
	return copyOut
}

func main() {
	port := envOr("PORT", "8083")
	apiKey := strings.TrimSpace(os.Getenv("OPS_API_KEY"))
	store := &eventStore{events: make([]eventRecord, 0)}

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

		var payload eventIngestRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
			return
		}
		payload.EventType = strings.TrimSpace(payload.EventType)
		if payload.EventType == "" {
			respondJSON(w, http.StatusBadRequest, map[string]any{"error": "eventType is required"})
			return
		}
		if strings.TrimSpace(payload.Source) == "" {
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
		respondJSON(w, http.StatusOK, map[string]any{
			"events": store.list(25),
		})
	})

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           loggingMiddleware(mux),
		ReadHeaderTimeout: 5 * time.Second,
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
