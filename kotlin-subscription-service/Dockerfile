FROM maven:3.9.9-eclipse-temurin-17@sha256:f58d59b6273e785ac0a4477f6e9b5ba1d7731c75b906c0f7b34076f1851318cc AS build
WORKDIR /app

COPY pom.xml .
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:17-jre@sha256:25e5ea42bca3a7f1d9b6a96f99416873346002f553954f5ec802d9060a115ecd
WORKDIR /app
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
COPY --from=build /app/target/kotlin-subscription-service-0.1.0.jar app.jar
RUN chown -R appuser:appgroup /app

EXPOSE 8084
USER appuser
ENTRYPOINT ["java", "-jar", "app.jar"]
