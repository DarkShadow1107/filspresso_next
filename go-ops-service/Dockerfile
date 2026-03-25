FROM golang:1.22-alpine AS build
WORKDIR /app

COPY go.mod .
COPY main.go .
RUN go build -ldflags="-s -w" -o go-ops-service main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /app/go-ops-service ./go-ops-service

EXPOSE 8083
ENTRYPOINT ["/app/go-ops-service"]
