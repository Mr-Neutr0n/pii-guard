package main

import (
	"encoding/json"
	"log"
	"net/http"
)

// ProxyHandler handles HTTP requests for the PII Guard proxy.
type ProxyHandler struct {
	presidio *PresidioClient
	config   *Config
}

type AnonymizeRequest struct {
	Text string `json:"text"`
}

// writeJSON writes v as JSON without HTML escaping (so <PERSON> stays readable).
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(v)
}

// HandleAnonymize receives text, calls Presidio, returns anonymized text + manifest.
func (h *ProxyHandler) HandleAnonymize(w http.ResponseWriter, r *http.Request) {
	var req AnonymizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if req.Text == "" {
		writeJSON(w, map[string]any{"text": "", "entities": []any{}, "count": 0})
		return
	}

	result, err := h.presidio.Anonymize(req.Text)
	if err != nil {
		log.Printf("Presidio anonymize error: %v", err)
		http.Error(w, `{"error":"presidio unavailable"}`, http.StatusBadGateway)
		return
	}

	log.Printf("Anonymized: %d entities found", result.Count)
	writeJSON(w, result)
}

// HandleAnalyze receives text, returns detected PII entities.
func (h *ProxyHandler) HandleAnalyze(w http.ResponseWriter, r *http.Request) {
	var req AnonymizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if req.Text == "" {
		writeJSON(w, map[string]any{"entities": []any{}, "count": 0})
		return
	}

	entities, err := h.presidio.Analyze(req.Text)
	if err != nil {
		log.Printf("Presidio analyze error: %v", err)
		http.Error(w, `{"error":"presidio unavailable"}`, http.StatusBadGateway)
		return
	}

	writeJSON(w, map[string]any{"entities": entities, "count": len(entities)})
}

// HandleHealth returns proxy and Presidio health status.
func (h *ProxyHandler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	presidioStatus := "ok"
	if err := h.presidio.Health(); err != nil {
		presidioStatus = "down"
	}

	status := "ok"
	if presidioStatus != "ok" {
		status = "degraded"
	}

	writeJSON(w, map[string]string{"status": status, "presidio": presidioStatus})
}

// HandleGetConfig returns current entity type configuration.
func (h *ProxyHandler) HandleGetConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, h.config.GetEntities())
}

// HandleSetConfig updates entity type configuration.
func (h *ProxyHandler) HandleSetConfig(w http.ResponseWriter, r *http.Request) {
	var updates map[string]bool
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	for entity, enabled := range updates {
		h.config.SetEntity(entity, enabled)
	}

	writeJSON(w, h.config.GetEntities())
}
