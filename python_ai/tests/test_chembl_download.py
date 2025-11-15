"""
Test script to demonstrate ChEMBL molecule downloader usage.

Run examples:
1. Download 10 molecules with embedded SVG/SDF:
   python test_chembl_download.py --mode embedded --limit 10

2. Download 50 molecules with separate SVG files:
   python test_chembl_download.py --mode files --limit 50

3. Download 100 molecules (text only):
   python test_chembl_download.py --mode text --limit 100
"""

import argparse
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Test ChEMBL molecule downloader")
    parser.add_argument(
        "--mode",
        choices=["text", "files", "embedded"],
        default="text",
        help="Download mode: text (metadata only), files (SVG/SDF as files), embedded (base64 in JSON)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Number of molecules to download (default: 10)",
    )
    
    args = parser.parse_args()
    
    # Build command
    cmd = [
        sys.executable,
        "download_all_chembl.py",
        "--limit", str(args.limit),
        "--batch-size", "50",
    ]
    
    if args.mode == "files":
        cmd.extend(["--download-svg", "--download-sdf"])
        print(f"📥 Downloading {args.limit} molecules with SVG and SDF files...")
    elif args.mode == "embedded":
        cmd.append("--embed-assets")
        print(f"📥 Downloading {args.limit} molecules with embedded SVG/SDF data...")
    else:
        print(f"📥 Downloading {args.limit} molecules (text metadata only)...")
    
    print(f"Command: {' '.join(cmd)}\n")
    
    # Run the downloader
    try:
        subprocess.run(cmd, cwd=Path(__file__).parent, check=True)
        print("\n✅ Download completed successfully!")
        
        # Show output location
        data_file = Path(__file__).parent / "data" / "chembl-molecules.json"
        if data_file.exists():
            print(f"📄 Dataset saved to: {data_file}")
            
            if args.mode == "files":
                svg_dir = Path(__file__).parent / "data" / "svg"
                sdf_dir = Path(__file__).parent / "data" / "sdf"
                if svg_dir.exists():
                    svg_count = len(list(svg_dir.glob("*.svg")))
                    print(f"🖼️  SVG files: {svg_count} saved in {svg_dir}")
                if sdf_dir.exists():
                    sdf_count = len(list(sdf_dir.glob("*.sdf")))
                    print(f"🧊 SDF files: {sdf_count} saved in {sdf_dir}")
        
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Download failed with exit code {e.returncode}")
        return 1
    except KeyboardInterrupt:
        print("\n⚠️  Download interrupted by user")
        return 130
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
