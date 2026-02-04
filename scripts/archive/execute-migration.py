#!/usr/bin/env python3
import sys
import os

try:
    import psycopg2
except ImportError:
    print('Installing psycopg2...')
    import subprocess
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'psycopg2-binary', '-q'])
    import psycopg2

# Load environment variables
from pathlib import Path
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            if '=' in line and not line.startswith('#'):
                key, value = line.strip().split('=', 1)
                os.environ[key] = value

# Supabase connection
try:
    print('\n' + '='*70)
    print('🚀 DATABASE MIGRATION 011: ADD CV EXTRACTION FIELDS')
    print('='*70 + '\n')
    
    print('⏳ Connecting to Supabase PostgreSQL...')
    
    password = os.environ.get('SUPABASE_DB_PASSWORD', 'MonsterBurger123!!')
    
    conn = psycopg2.connect(
        host='db.hncvsextwmvjydcukdwx.supabase.co',
        port=5432,
        database='postgres',
        user='postgres',
        password=password,
        sslmode='require',
        connect_timeout=10
    )
    
    cursor = conn.cursor()
    print('✅ Connected!\n')
    
    # Read migration file
    with open('migrations/011_add_cv_extraction_fields.sql', 'r', encoding='utf-8') as f:
        sql = f.read()
    
    print('⏳ Executing migration SQL...\n')
    
    # Execute the SQL
    cursor.execute(sql)
    conn.commit()
    
    print('✅ Migration SQL executed successfully!\n')
    
    # Verify columns were created
    print('🔍 Verifying new columns...\n')
    
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
        ORDER BY column_name
    """
    
    cursor.execute(verify_sql)
    columns = [row[0] for row in cursor.fetchall()]
    
    if columns:
        print(f'✅ SUCCESS! Found {len(columns)}/14 new columns:\n')
        for col in columns:
            print(f'   ✓ {col}')
        print('\n' + '='*70)
        print('✨ MIGRATION COMPLETED SUCCESSFULLY!')
        print('='*70 + '\n')
        
        # Check extraction_history table
        cursor.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_name='extraction_history'")
        if cursor.fetchone()[0] > 0:
            print('✅ extraction_history table created\n')
    else:
        print('⚠️  Warning: Could not verify new columns\n')
    
    cursor.close()
    conn.close()
    
    sys.exit(0)
    
except psycopg2.OperationalError as e:
    print(f'\n❌ Connection Error: {str(e)}\n')
    print('The secret key provided may not be the database password.')
    print('Please check your Supabase project settings for the correct password.\n')
    sys.exit(1)
    
except Exception as e:
    print(f'\n❌ Error: {str(e)}\n')
    import traceback
    traceback.print_exc()
    sys.exit(1)
