package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// SidecarManager manages the Presidio Python process lifecycle.
type SidecarManager struct {
	cmd        *exec.Cmd
	running    bool
	projectDir string
}

func NewSidecarManager(projectDir string) *SidecarManager {
	return &SidecarManager{projectDir: projectDir}
}

func (s *SidecarManager) Start() error {
	// Check if Presidio is already running externally
	if s.isHealthy() {
		log.Println("Presidio already running on :9401")
		s.running = true
		return nil
	}

	presidioDir := filepath.Join(s.projectDir, "presidio")
	venvPython := filepath.Join(presidioDir, ".venv", "bin", "python")

	// Check venv exists
	if _, err := os.Stat(venvPython); os.IsNotExist(err) {
		return fmt.Errorf("presidio venv not found at %s — run 'make setup' first", venvPython)
	}

	log.Println("Starting Presidio sidecar...")
	s.cmd = exec.Command(venvPython, "app.py")
	s.cmd.Dir = presidioDir
	s.cmd.Stdout = os.Stdout
	s.cmd.Stderr = os.Stderr

	if err := s.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start Presidio: %w", err)
	}

	// Wait for health check (spaCy model load takes 5-10s)
	if err := s.waitForHealthy(60 * time.Second); err != nil {
		s.Stop()
		return fmt.Errorf("Presidio failed to become healthy: %w", err)
	}

	s.running = true
	log.Println("Presidio sidecar healthy on :9401")
	return nil
}

func (s *SidecarManager) Stop() {
	if s.cmd != nil && s.cmd.Process != nil {
		log.Println("Stopping Presidio sidecar...")
		_ = s.cmd.Process.Kill()
		_ = s.cmd.Wait()
		s.running = false
	}
}

func (s *SidecarManager) isHealthy() bool {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:9401/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func (s *SidecarManager) waitForHealthy(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if s.isHealthy() {
			return nil
		}
		// Check if process died
		if s.cmd.ProcessState != nil && s.cmd.ProcessState.Exited() {
			return fmt.Errorf("presidio process exited with code %d", s.cmd.ProcessState.ExitCode())
		}
		time.Sleep(1 * time.Second)
	}
	return fmt.Errorf("timed out after %s", timeout)
}
