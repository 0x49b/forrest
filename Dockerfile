# Multi-stage build
FROM node:20-alpine AS frontend-builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM golang:1.24-alpine AS backend-builder

WORKDIR /app
COPY go.* ./
RUN go mod download

COPY backend/ ./backend/
COPY main.go ./
COPY --from=frontend-builder /app/dist ./dist

RUN go build -o /app/forrest-server .

FROM alpine:latest

RUN apk --no-cache add ca-certificates
WORKDIR /root/

COPY --from=backend-builder /app/forrest-server ./

EXPOSE 8080

ENV PORT=8080

CMD ["./forrest-server"]
