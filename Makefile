.PHONY: setup setup-presidio setup-e2e build run run-presidio test test-presidio test-e2e clean

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

# E2E test setup: install Playwright + Chromium
setup-e2e:
	pip install -r e2e/requirements.txt && python -m playwright install chromium

# E2E test: launch browser with extension, type PII, capture network requests
test-e2e:
	python ~/.claude/skills/test-extension/scripts/capture.py \
		--extension extension/ \
		--type-text "My name is Rahul Sharma, email rahul@company.com, phone +91 98765 43210, PAN ABCPT1234F." \
		--output /tmp/pii-guard-capture.json

# E2E discovery: observe typing telemetry without sending
test-e2e-discovery:
	python ~/.claude/skills/test-extension/scripts/capture.py \
		--extension extension/ \
		--type-text "My name is Test User, SSN 999-88-7777, email test@pii-guard-test.com" \
		--no-send \
		--output /tmp/pii-guard-capture.json

# E2E interactive: manual testing in browser
test-e2e-interactive:
	python ~/.claude/skills/test-extension/scripts/capture.py \
		--extension extension/ \
		--interactive \
		--output /tmp/pii-guard-capture.json

# Clean build artifacts
clean:
	rm -f proxy/pii-guard-proxy
