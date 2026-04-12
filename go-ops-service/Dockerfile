FROM golang:1.22-alpine@sha256:1699c10032ca2582ec89a24a1312d986a3f094aed3d5c1147b19880afe40e052 AS build
WORKDIR /app

COPY go.mod .
COPY main.go .
ENV CGO_ENABLED=0
RUN go build -mod=mod -trimpath -ldflags="-s -w" -o go-ops-service main.go

FROM alpine:3.20@sha256:a4f4213abb84c497377b8544c81b3564f313746700372ec4fe84653e4fb03805
WORKDIR /app
RUN apk add --no-cache ca-certificates tini \
	&& addgroup -S appgroup \
	&& adduser -S appuser -G appgroup
COPY --from=build /app/go-ops-service ./go-ops-service
RUN chown -R appuser:appgroup /app \
	&& chmod 0555 /app/go-ops-service

EXPOSE 8083
USER appuser
ENTRYPOINT ["/sbin/tini", "--", "/app/go-ops-service"]
