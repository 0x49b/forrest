# forrest

## How to Use

### Development Mode:

#### Terminal 1: Frontend dev server

```shell
npm run dev
```

#### Terminal 2: Backend server

```shell
go run main.go
```

### Production Build:

```shell
make build              # Builds everything
```

```shell
./bin/forrest-server    # Run on port 8081 (or PORT=3000 ./bin/forrest-server)
```

### Docker:

```shell
docker-compose up    # Builds and runs everything
```

## Key Features

### Backend:

- 🚀 Fast - Goroutines handle 100+ concurrent NPM fetches
- 💾 Efficient Caching - 10,000-entry LRU cache, concurrent requests for the same package are deduplicated
- 📉 Small Payloads - Versions are resolved from abbreviated npm metadata, only the matching version manifest is downloaded
- 📡 Real-time Updates - SSE streams progress and results, batched every 100ms
- 📦 Single Binary - Frontend embedded with embed.FS
- 🔒 Type-Safe - Go structs match frontend TypeScript interfaces

### Frontend:

- 🎯 No UI Blocking - All processing happens on backend
- 📊 Real-time Progress - Live updates via SSE
- 🔄 Same UI - Existing components work without changes
- 🗑️ Cleaner - No more web worker complexity
