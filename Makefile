.PHONY: build-frontend build-backend build run dev clean test

# Build frontend
build-frontend:
	npm install
	npm run build

# Build backend (with embedded frontend)
build-backend: build-frontend
	go build -o bin/forrest-server .

# Build both
build: build-backend

# Run server
run: build
	./bin/forrest-server

# Development mode (separate processes)
dev:
	@echo "Starting frontend dev server on http://localhost:5173..."
	@echo "Starting backend server on http://localhost:8080..."
	@(cd . && npm run dev) & (cd . && go run main.go)

# Clean build artifacts
clean:
	rm -rf bin/
	rm -rf dist/
	go clean

# Test backend
test:
	go test ./backend/pkg/...

# Run with hot reload (requires air: go install github.com/cosmtrek/air@latest)
dev-backend:
	air

# Install development dependencies
install-dev:
	go install github.com/cosmtrek/air@latest

# Format code
fmt:
	go fmt ./...
	npm run format || true

# Lint code
lint:
	go vet ./...
	npm run lint || true
