FROM rust:1.88-alpine@sha256:9dfaae478ecd298b6b5a039e1f2cc4fc040fc818a2de9aa78fa714dea036574d AS build
WORKDIR /app

RUN apk add --no-cache musl-dev

COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

FROM alpine:3.20@sha256:a4f4213abb84c497377b8544c81b3564f313746700372ec4fe84653e4fb03805
WORKDIR /app

RUN apk add --no-cache ca-certificates tini wget \
    && addgroup -S appgroup \
    && adduser -S appuser -G appgroup

COPY --from=build /app/target/release/rust-crypto-service /app/rust-crypto-service
RUN chown -R appuser:appgroup /app \
    && chmod 0555 /app/rust-crypto-service

EXPOSE 8090
USER appuser
ENTRYPOINT ["/sbin/tini", "--", "/app/rust-crypto-service"]
