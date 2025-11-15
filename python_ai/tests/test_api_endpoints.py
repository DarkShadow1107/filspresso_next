"""
Test API endpoints for molecule rendering
Run this while Flask server is running (python app.py)
"""

import requests
import json
from pathlib import Path

BASE_URL = "http://localhost:5000/api"
TEST_MOLECULE = "CHEMBL10"  # SB-203580

print("\n" + "="*60)
print("Testing Molecule Rendering API Endpoints")
print("="*60 + "\n")

# Test 1: Search molecules
print("Test 1: Search Molecules")
print("-" * 60)
try:
    response = requests.get(f"{BASE_URL}/molecules/search", params={"q": "IMIPRAMINE", "limit": 5})
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Search successful: Found {data['count']} molecules")
        if data['molecules']:
            print(f"   First result: {data['molecules'][0]['name']}")
    else:
        print(f"❌ Search failed: HTTP {response.status_code}")
except Exception as e:
    print(f"❌ Error: {e}")

print()

# Test 2: Get molecule details
print("Test 2: Get Molecule Details")
print("-" * 60)
try:
    response = requests.get(f"{BASE_URL}/molecule/{TEST_MOLECULE}")
    if response.status_code == 200:
        data = response.json()
        mol = data['molecule']
        print(f"✅ Details retrieved for {TEST_MOLECULE}")
        print(f"   Name: {mol.get('name')}")
        print(f"   Formula: {mol.get('molecular_formula')}")
        print(f"   MW: {mol.get('molecular_weight')}")
    else:
        print(f"❌ Details failed: HTTP {response.status_code}")
except Exception as e:
    print(f"❌ Error: {e}")

print()

# Test 3: Get 2D image
print("Test 3: Get 2D PNG Image")
print("-" * 60)
try:
    response = requests.get(f"{BASE_URL}/molecule/render2d/{TEST_MOLECULE}", 
                          params={"width": 500, "height": 500})
    if response.status_code == 200:
        img_size = len(response.content)
        print(f"✅ 2D image generated: {img_size} bytes")
        
        # Save to file
        output_path = Path(__file__).parent.parent / f"test_2d_{TEST_MOLECULE}.png"
        with open(output_path, 'wb') as f:
            f.write(response.content)
        print(f"   Saved to: {output_path}")
    else:
        print(f"❌ 2D render failed: HTTP {response.status_code}")
except Exception as e:
    print(f"❌ Error: {e}")

print()

# Test 4: Get 3D viewer HTML
print("Test 4: Get 3D Interactive Viewer")
print("-" * 60)
try:
    response = requests.get(f"{BASE_URL}/molecule/render3d/{TEST_MOLECULE}", 
                          params={"style": "stick"})
    if response.status_code == 200:
        html_size = len(response.content)
        print(f"✅ 3D viewer HTML generated: {html_size} bytes")
        
        # Save to file
        output_path = Path(__file__).parent.parent / f"test_3d_{TEST_MOLECULE}.html"
        with open(output_path, 'wb') as f:
            f.write(response.content)
        print(f"   Saved to: {output_path}")
        print(f"   Open this file in a browser to view 3D molecule!")
    else:
        print(f"❌ 3D render failed: HTTP {response.status_code}")
except Exception as e:
    print(f"❌ Error: {e}")

print()

# Test 5: Get molecular properties
print("Test 5: Get Molecular Properties")
print("-" * 60)
try:
    response = requests.get(f"{BASE_URL}/molecule/properties/{TEST_MOLECULE}")
    if response.status_code == 200:
        data = response.json()
        props = data['properties']
        print(f"✅ Properties calculated for {TEST_MOLECULE}")
        print(f"   Molecular Weight: {props['molecular_weight']}")
        print(f"   LogP: {props['logp']}")
        print(f"   H-Bond Donors: {props['hbd']}")
        print(f"   H-Bond Acceptors: {props['hba']}")
        print(f"   TPSA: {props['tpsa']}")
        print(f"   Lipinski Violations: {props['lipinski_violations']}")
    else:
        print(f"❌ Properties failed: HTTP {response.status_code}")
        print(f"   Response: {response.text}")
except Exception as e:
    print(f"❌ Error: {e}")

print()

# Test 6: Download molecule data (ZIP)
print("Test 6: Download Molecule Data (All Formats)")
print("-" * 60)
try:
    response = requests.get(f"{BASE_URL}/molecule/download/{TEST_MOLECULE}", 
                          params={"format": "all"})
    if response.status_code == 200:
        zip_size = len(response.content)
        print(f"✅ ZIP file created: {zip_size} bytes")
        
        # Save to file
        output_path = Path(__file__).parent.parent / f"test_download_{TEST_MOLECULE}.zip"
        with open(output_path, 'wb') as f:
            f.write(response.content)
        print(f"   Saved to: {output_path}")
        print(f"   Contains: SDF, MOL, PDB, SMILES, JSON")
    else:
        print(f"❌ Download failed: HTTP {response.status_code}")
except Exception as e:
    print(f"❌ Error: {e}")

print()

# Test 7: Download SDF only
print("Test 7: Download SDF File")
print("-" * 60)
try:
    response = requests.get(f"{BASE_URL}/molecule/download/{TEST_MOLECULE}", 
                          params={"format": "sdf"})
    if response.status_code == 200:
        sdf_size = len(response.content)
        print(f"✅ SDF file created: {sdf_size} bytes")
        
        # Save to file
        output_path = Path(__file__).parent.parent / f"test_{TEST_MOLECULE}.sdf"
        with open(output_path, 'wb') as f:
            f.write(response.content)
        print(f"   Saved to: {output_path}")
        print(f"   Can be opened in PyMOL or other molecular viewers")
    else:
        print(f"❌ SDF download failed: HTTP {response.status_code}")
except Exception as e:
    print(f"❌ Error: {e}")

print()

# Test 8: Test different visualization styles
print("Test 8: Test Different 3D Visualization Styles")
print("-" * 60)
styles = ['stick', 'sphere', 'line', 'cross']
for style in styles:
    try:
        response = requests.get(f"{BASE_URL}/molecule/render3d/{TEST_MOLECULE}", 
                              params={"style": style})
        if response.status_code == 200:
            print(f"   ✅ {style.capitalize()} style: {len(response.content)} bytes")
        else:
            print(f"   ❌ {style.capitalize()} style failed")
    except Exception as e:
        print(f"   ❌ {style.capitalize()} error: {e}")

print()

# Summary
print("="*60)
print("Test Summary")
print("="*60)
print(f"""
✅ All API endpoints tested!

Generated Files:
- test_2d_{TEST_MOLECULE}.png (2D structure image)
- test_3d_{TEST_MOLECULE}.html (3D interactive viewer - open in browser)
- test_download_{TEST_MOLECULE}.zip (all formats)
- test_{TEST_MOLECULE}.sdf (SDF file for PyMOL)

Next Steps:
1. Open test_3d_{TEST_MOLECULE}.html in your browser
2. Open test_{TEST_MOLECULE}.sdf in PyMOL
3. Integrate these endpoints with the frontend
4. Test with different molecules (CHEMBL11, CHEMBL12, etc.)

Available Molecules: 100 molecules downloaded
Test different IDs: CHEMBL10, CHEMBL11, CHEMBL12, CHEMBL13, etc.
""")

print("\n🎉 API endpoint tests completed!\n")
