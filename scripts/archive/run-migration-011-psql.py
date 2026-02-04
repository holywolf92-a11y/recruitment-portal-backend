#!/usr/bin/env python3
"""
Migration 011: Add CV Extraction Fields - Using PostgreSQL Direct Connection
Executes raw SQL statements directly via Supabase PostgreSQL connection
"""

import os
import sys
import psycopg2
from pathlib import Path

# Supabase credentials
SUPABASE_HOST = "db.hncvsextwmvjydcukdwx.supabase.co"
SUPABASE_PORT = 5432
SUPABASE_DB = "postgres"
SUPABASE_USER = "postgres"
SUPABASE_PASSWORD = os.environ.get("SUPABASE_PASSWORD") or (sys.argv[1] if len(sys.argv) > 1 else None)

if not SUPABASE_PASSWORD:
    print("❌ Missing Supabase password\n")
    print("Usage: python3 run-migration-011-psql.py <SUPABASE_PASSWORD>")
    print("  or set SUPABASE_PASSWORD environment variable\n")
    sys.exit(1)

# Read migration file
migration_file = Path(__file__).parent.parent / "migrations" / "011_add_cv_extraction_fields.sql"

if not migration_file.exists():
    print(f"❌ Migration file not found: {migration_file}")
    sys.exit(1)

migration_sql = migration_file.read_text()

print("\n🚀 Migration 011: Add CV Extraction Fields (via PostgreSQL)\n")
print(f"📍 Target: {SUPABASE_HOST}:{SUPABASE_PORT}/{SUPABASE_DB}")
print(f"👤 User: {SUPABASE_USER}\n")

try:
    # Connect to Supabase PostgreSQL
    print("⏳ Connecting to database...")
    conn = psycopg2.connect(
        host=SUPABASE_HOST,
        port=SUPABASE_PORT,
        database=SUPABASE_DB,
        user=SUPABASE_USER,
        password=SUPABASE_PASSWORD,
        sslmode="require"
    )
    
    cursor = conn.cursor()
    print("✅ Connected!\n")
    
    # Execute migration SQL
    print("⏳ Executing migration SQL statements...\n")
    
    # Split by semicolon and execute each statement
    statements = [stmt.strip() for stmt in migration_sql.split(';') if stmt.strip()]
    
    successful = 0
    failed = 0
    
    for i, statement in enumerate(statements, 1):
        try:
            display_stmt = statement[:70] + ("..." if len(statement) > 70 else "")
            print(f"  [{i}/{len(statements)}] {display_stmt}")
            cursor.execute(statement)
            conn.commit()
            print(f"       ✓ Success\n")
            successful += 1
        except Exception as e:
            if "already exists" in str(e).lower():
                print(f"       ⚠️  Already exists (skipped)\n")
            else:
                print(f"       ❌ Error: {str(e)[:100]}\n")
                failed += 1
    
    print("\n📊 Execution Summary:")
    print(f"   Successful: {successful}")
    print(f"   Failed:     {failed}\n")
    
    # Verify migration
    print("✓ Verifying columns were created...\n")
    
    verify_sql = """
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name='candidates' 
    AND column_name IN (
        'nationality', 'position', 'experience_years', 'country_of_interest',
        'skills', 'languages', 'education', 'certifications',
        'previous_employment', 'passport_expiry', 'professional_summary',
        'extraction_confidence', 'extraction_source', 'extracted_at'
    )
    ORDER BY column_name;
    """
    
    cursor.execute(verify_sql)
    columns = [row[0] for row in cursor.fetchall()]
    
    if columns:
        print(f"✅ SUCCESS! Found {len(columns)}/14 new columns:\n")
        for col in columns:
            print(f"   ✓ {col}")
        print(f"\n✨ Migration completed successfully!\n")
    else:
        print("⚠️  Warning: Could not verify columns were created")
        print("   Check Supabase dashboard to confirm\n")
    
    cursor.close()
    conn.close()
    sys.exit(0)

except psycopg2.OperationalError as e:
    print(f"\n❌ Connection Error:\n{str(e)}\n")
    print("📝 Troubleshooting:")
    print("   1. Verify password is correct")
    print("   2. Check network access to Supabase")
    print("   3. Verify IP whitelist in Supabase settings")
    print("   4. Try manual execution via Supabase dashboard:")
    print("\n      https://app.supabase.com/project/hncvsextwmvjydcukdwx/sql/new\n")
    sys.exit(1)
except Exception as e:
    print(f"\n❌ Error:\n{str(e)}\n")
    print("📝 Try manual execution via Supabase dashboard:")
    print("   https://app.supabase.com/project/hncvsextwmvjydcukdwx/sql/new\n")
    sys.exit(1)
