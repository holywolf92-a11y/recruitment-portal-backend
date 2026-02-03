#!/usr/bin/env python3
"""Check if Sharafat and Abdullah CVs contain images"""

import sys
import os
sys.path.insert(0, '/app')  # Add python-parser to path

from supabase import create_client
from dotenv import load_dotenv
import fitz  # PyMuPDF

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print("❌ Supabase credentials not set")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

cvs_to_check = [
    {"path": "inbox/Sharafat Updated.pdf", "name": "Sharafat Updated.pdf"},
    {"path": "inbox/Abdullah cv.pdf", "name": "Abdullah cv.pdf"},
]

for cv_info in cvs_to_check:
    try:
        print(f"\n📄 {cv_info['name']}:")
        
        # Download CV from storage
        response = sb.storage.from_("documents").download(cv_info["path"])
        
        # Parse PDF
        pdf_doc = fitz.open(stream=response, filetype="pdf")
        print(f"   Pages: {pdf_doc.page_count}")
        
        # Check first page for images
        first_page = pdf_doc[0]
        images = first_page.get_images(full=True)
        print(f"   Images on page 1: {len(images)}")
        
        if images:
            for i, img_info in enumerate(images):
                xref = img_info[0]
                img_dict = pdf_doc.extract_image(xref)
                width = img_dict.get("width", 0)
                height = img_dict.get("height", 0)
                ext = img_dict.get("ext", "unknown")
                size = len(img_dict.get("image", b""))
                
                # Calculate coverage
                page_area = first_page.rect.width * first_page.rect.height
                img_rects = first_page.get_image_rects(xref)
                coverage = 0
                if img_rects:
                    rect = img_rects[0]
                    coverage = (rect.width * rect.height) / page_area
                
                print(f"      Image {i}: {width}x{height} {ext} {size} bytes coverage={coverage:.1%}")
        
        pdf_doc.close()
        
    except Exception as e:
        print(f"   ❌ Error: {e}")
        import traceback
        traceback.print_exc()

print("\n✅ Done")
