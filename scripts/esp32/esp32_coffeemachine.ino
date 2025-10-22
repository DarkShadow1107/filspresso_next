/*
  Example ESP32 sketch (pseudo-production) showing how a Wi-Fi connected
  coffee machine could poll the backend for pending commands, retrieve recipes,
  update status, and execute them.

  Notes:
  - This sketch uses Arduino-style APIs (WiFi, HTTPClient, ArduinoJson)
  - In real hardware, the pump/heater control needs safety, calibration, and proper power handling
  - Use TLS (HTTPS) in production and token-based auth
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Replace with your WiFi credentials
const char* ssid = "YOUR_SSID";
const char* password = "YOUR_PASSWORD";

const char* SERVER = "http://your-backend-host:5000"; // Use https in production
const char* MACHINE_ID = "MACHINE_ID_123";

unsigned long POLL_INTERVAL_MS = 5000;
unsigned long lastPoll = 0;

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.println("\nConnected!");

  // Setup pins for pump/heater/valves (example)
  pinMode(2, OUTPUT); // Heater relay
  pinMode(4, OUTPUT); // Pump
  digitalWrite(2, LOW);
  digitalWrite(4, LOW);
}

void loop() {
  unsigned long now = millis();
  if (now - lastPoll > POLL_INTERVAL_MS) {
    lastPoll = now;
    checkForCommand();
  }
}

void checkForCommand() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SERVER) + "/api/commands/check/" + MACHINE_ID;
  http.begin(url);
  int httpCode = http.GET();
  if (httpCode == 204) {
    Serial.println("No pending command");
  } else if (httpCode == 200) {
    String payload = http.getString();
    Serial.println("Received command: " + payload);
    StaticJsonDocument<1024> doc;
    DeserializationError err = deserializeJson(doc, payload);
    if (err) {
      Serial.println("JSON parse error");
    } else {
      int command_id = doc["command_id"];
      JsonObject recipe = doc["recipe"].as<JsonObject>();
      bool execute_allowed = doc["execute_allowed"] | true;

      if (execute_allowed) {
        // Update status to brewing
        postUpdate(command_id, "brewing", {"notes":"started by device"});

        // Example: parse recipe fields
        int volume_ml = recipe["volume_ml"] | 40;
        int temp_c = recipe["temperature_c"] | 92;
        int pre_ms = recipe["pre_infusion_ms"] | 0;

        // Execute the recipe - pseudo functions
        heatTo(temp_c);
        preInfuse(pre_ms);
        pumpVolume(volume_ml);

        // Once done, update status to complete
        postUpdate(command_id, "complete", {"actual_volume_ml": volume_ml});
      } else {
        // Not allowed to execute; still mark handled
        postUpdate(command_id, "failed", {"reason":"execute_not_allowed"});
      }
    }
  } else {
    Serial.println("HTTP error: " + String(httpCode));
  }
  http.end();
}

void postUpdate(int command_id, const char* status, JsonObject metaObj) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String(SERVER) + "/api/commands/update/" + String(command_id);
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> payload;
  payload["status"] = status;
  JsonObject meta = payload.createNestedObject("meta");
  // Copy metaObj to payload.meta (pseudo, metaObj usage depends on deserialization)

  String out;
  serializeJson(payload, out);
  int httpCode = http.POST(out);
  if (httpCode == 200) {
    Serial.println("Updated command status: " + String(status));
  } else {
    Serial.println("Failed to update command: " + String(httpCode));
  }
  http.end();
}

// Pseudo helper functions - implement hardware control here with safety
void heatTo(int temp_c) {
  Serial.println("Heating to " + String(temp_c) + "C (pseudo)");
  digitalWrite(2, HIGH);
  delay(2000); // simulate heating
  digitalWrite(2, LOW);
}

void preInfuse(int ms) {
  if (ms <= 0) return;
  Serial.println("Pre-infusion: " + String(ms) + " ms");
  digitalWrite(4, HIGH);
  delay(ms);
  digitalWrite(4, LOW);
}

void pumpVolume(int ml) {
  // Need calibration: ms_per_ml determined experimentally
  const int ms_per_ml = 100; // example calibration
  int total_ms = ml * ms_per_ml;
  Serial.println("Pumping for " + String(total_ms) + " ms for " + String(ml) + " ml");
  digitalWrite(4, HIGH);
  delay(total_ms);
  digitalWrite(4, LOW);
}
