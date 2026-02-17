.PHONY: setup setup-presidio build run run-presidio test test-presidio clean

# One-time setup: create venv, install deps, download spaCy model
setup: setup-presidio
	@echo "Setup complete. Run 'make run' to start."

setup-presidio:
	cd presidio && bash setup.sh

# Build Go proxy binary
build:
	cd proxy && go build -o pii-guard-proxy .

# Run the proxy (auto-starts Presidio sidecar)
run: build
	cd proxy && PII_GUARD_PROJECT_DIR="$(CURDIR)" ./pii-guard-proxy

# Run Presidio engine standalone (for testing)
run-presidio:
	cd presidio && . .venv/bin/activate && python app.py

# Run Presidio tests
test-presidio:
	cd presidio && . .venv/bin/activate && python -m pytest tests/ -v

# Run Go proxy tests
test-proxy:
	cd proxy && go test ./... -v

# Run all tests
test: test-presidio test-proxy

# Clean build artifacts
clean:
	rm -f proxy/pii-guard-proxy
