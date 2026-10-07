# syntax=docker/dockerfile:1

FROM node:20-alpine AS frontend-builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig*.json postcss.config.js tailwind.config.js ./
COPY src/ ./src/
RUN npm run build

FROM golang:1.27-alpine AS backend-builder

WORKDIR /app
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY backend/ ./backend/
COPY main.go ./
COPY --from=frontend-builder /app/dist ./dist

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /forrest-server .

# Static binary: distroless ships CA certificates and runs as non-root.
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=backend-builder /forrest-server /forrest-server

EXPOSE 8080
ENV PORT=8080

ENTRYPOINT ["/forrest-server"]
