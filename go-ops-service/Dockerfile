FROM golang:1.22-alpine AS build
WORKDIR /app

COPY go.mod .
COPY main.go .
RUN go build -mod=mod -ldflags="-s -w" -o go-ops-service main.go

FROM alpine:3.20
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=build /app/go-ops-service ./go-ops-service
RUN chown -R appuser:appgroup /app

EXPOSE 8083
USER appuser
ENTRYPOINT ["/app/go-ops-service"]
