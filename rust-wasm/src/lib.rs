use serde_json::{Map, Value};
use sha3::{Digest, Sha3_256};
use wasm_bindgen::prelude::*;

fn canonicalize_json(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<String> = map.keys().cloned().collect();
            keys.sort();

            let mut ordered = Map::new();
            for key in keys {
                if let Some(inner) = map.get(&key) {
                    ordered.insert(key, canonicalize_json(inner.clone()));
                }
            }

            Value::Object(ordered)
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(canonicalize_json).collect()),
        other => other,
    }
}

fn hash_with_domain(domain: &str, payload: &str) -> String {
    let material = format!("{}|{}", domain, payload);
    let mut hasher = Sha3_256::new();
    hasher.update(material.as_bytes());
    let digest = hasher.finalize();
    hex::encode(digest)
}

#[wasm_bindgen]
pub fn sha3_256_commitment(domain: &str, payload: &str) -> String {
    hash_with_domain(domain, payload)
}

#[wasm_bindgen]
pub fn preprocess_witness(json_payload: &str) -> Result<String, JsValue> {
    let value: Value =
        serde_json::from_str(json_payload).map_err(|e| JsValue::from_str(&format!("Invalid JSON: {}", e)))?;

    let canonical = canonicalize_json(value);
    serde_json::to_string(&canonical)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize canonical JSON: {}", e)))
}

#[wasm_bindgen]
pub fn preprocess_witness_and_commit(domain: &str, json_payload: &str) -> Result<JsValue, JsValue> {
    let canonical = preprocess_witness(json_payload)?;
    let commitment = sha3_256_commitment(domain, &canonical);

    let response = serde_json::json!({
        "domain": domain,
        "canonical": canonical,
        "sha3_256": commitment,
    });

    JsValue::from_serde(&response)
        .map_err(|e| JsValue::from_str(&format!("Failed to encode response: {}", e)))
}
