FROM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /app

COPY pom.xml .
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
COPY --from=build /app/target/kotlin-subscription-service-0.1.0.jar app.jar
RUN chown -R appuser:appgroup /app

EXPOSE 8084
USER appuser
ENTRYPOINT ["java", "-jar", "app.jar"]
