package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
)

func main() {
	// Resolve project root (proxy binary lives in proxy/, project root is one level up)
	execPath, err := os.Executable()
	if err != nil {
		log.Fatalf("Failed to get executable path: %v", err)
	}
	projectDir := filepath.Dir(filepath.Dir(execPath))

	// Allow override via env var (useful for development)
	if envDir := os.Getenv("PII_GUARD_PROJECT_DIR"); envDir != "" {
		projectDir = envDir
	}

	// Start Presidio sidecar
	sidecar := NewSidecarManager(projectDir)
	if err := sidecar.Start(); err != nil {
		log.Fatalf("Failed to start Presidio: %v", err)
	}

	// Initialize components
	config := NewConfig()
	presidio := NewPresidioClient()
	handler := &ProxyHandler{presidio: presidio, config: config}

	// Set up routes
	mux := http.NewServeMux()
	mux.HandleFunc("POST /anonymize", handler.HandleAnonymize)
	mux.HandleFunc("POST /analyze", handler.HandleAnalyze)
	mux.HandleFunc("GET /health", handler.HandleHealth)
	mux.HandleFunc("GET /config", handler.HandleGetConfig)
	mux.HandleFunc("PUT /config", handler.HandleSetConfig)

	// CORS middleware
	corsHandler := corsMiddleware(mux)

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Println("\nShutting down...")
		sidecar.Stop()
		os.Exit(0)
	}()

	addr := "127.0.0.1:9400"
	fmt.Printf("PII Guard proxy listening on %s\n", addr)
	log.Fatal(http.ListenAndServe(addr, corsHandler))
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
