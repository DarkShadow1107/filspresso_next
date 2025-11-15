#!/usr/bin/env python3
"""
Test script for Tanka Chemistry Mode API
Demonstrates chemistry mode usage and subscription validation
"""

import requests
import json

BASE_URL = "http://localhost:5000"

def print_response(response):
    """Pretty print JSON response"""
    print(f"Status: {response.status_code}")
    try:
        print(json.dumps(response.json(), indent=2))
    except:
        print(response.text)
    print()

def test_health():
    """Test health endpoint"""
    print("=" * 80)
    print("1. Testing Health Endpoint")
    print("=" * 80)
    response = requests.get(f"{BASE_URL}/api/health")
    print_response(response)

def test_regular_tanka():
    """Test regular Tanka without chemistry mode"""
    print("=" * 80)
    print("2. Testing Regular Tanka (Any subscription)")
    print("=" * 80)
    data = {
        "model": "tanka",
        "prompt": "What is the ideal brewing temperature for espresso?",
        "max_length": 128,
        "temperature": 0.7,
        "subscription": "basic"
    }
    response = requests.post(f"{BASE_URL}/api/generate", json=data)
    print_response(response)

def test_chemistry_unauthorized():
    """Test chemistry mode with non-Ultimate subscription (should fail)"""
    print("=" * 80)
    print("3. Testing Chemistry Mode - Unauthorized (Basic subscription)")
    print("=" * 80)
    data = {
        "model": "tanka",
        "prompt": "Explain the molecular structure of caffeine",
        "chemistry_mode": True,
        "subscription": "basic",
        "temperature": 0.7
    }
    response = requests.post(f"{BASE_URL}/api/generate", json=data)
    print_response(response)

def test_chemistry_authorized():
    """Test chemistry mode with Ultimate subscription"""
    print("=" * 80)
    print("4. Testing Chemistry Mode - Authorized (Ultimate subscription)")
    print("=" * 80)
    data = {
        "model": "tanka",
        "prompt": "Explain the molecular structure of caffeine and its effects",
        "chemistry_mode": True,
        "subscription": "ultimate",
        "max_length": 256,
        "temperature": 0.7
    }
    response = requests.post(f"{BASE_URL}/api/generate", json=data)
    print_response(response)

def test_chemistry_chat():
    """Test chemistry mode in chat"""
    print("=" * 80)
    print("5. Testing Chemistry Mode Chat (Ultimate)")
    print("=" * 80)
    data = {
        "model": "tanka",
        "message": "What compounds give coffee its antioxidant properties?",
        "chemistry_mode": True,
        "subscription": "ultimate",
        "temperature": 0.7
    }
    response = requests.post(f"{BASE_URL}/api/chat", json=data)
    print_response(response)

def test_models_info():
    """Test models info endpoint"""
    print("=" * 80)
    print("6. Testing Models Info")
    print("=" * 80)
    response = requests.get(f"{BASE_URL}/api/models")
    print_response(response)

def main():
    """Run all tests"""
    print()
    print("🧪 Tanka Chemistry Mode API Test Suite")
    print()
    print("Make sure the Flask server is running on http://localhost:5000")
    print("Start server with: python app.py")
    print()
    input("Press Enter to start tests...")
    print()
    
    try:
        # Run tests
        test_health()
        test_regular_tanka()
        test_chemistry_unauthorized()
        test_chemistry_authorized()
        test_chemistry_chat()
        test_models_info()
        
        print("=" * 80)
        print("✅ All tests completed!")
        print("=" * 80)
        print()
        print("Summary:")
        print("  - Regular Tanka: Works with any subscription")
        print("  - Chemistry Mode: Requires Ultimate subscription")
        print("  - Unauthorized access returns 403 Forbidden")
        print("  - Authorized access returns generated chemistry content")
        print()
        
    except requests.exceptions.ConnectionError:
        print()
        print("❌ Error: Could not connect to Flask server")
        print("Please make sure the server is running:")
        print("  cd python_ai")
        print("  python app.py")
        print()
    except Exception as e:
        print()
        print(f"❌ Error during testing: {e}")
        import traceback
        traceback.print_exc()
        print()

if __name__ == "__main__":
    main()
