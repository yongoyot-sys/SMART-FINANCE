import os

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'smart-finance-super-secret-key-2026')
    
    # Konfigurasi Database MySQL
    DB_HOST = os.environ.get('DB_HOST', 'localhost')
    DB_USER = os.environ.get('DB_USER', 'root')
    DB_PASSWORD = os.environ.get('DB_PASSWORD', '')
    DB_NAME = os.environ.get('DB_NAME', 'smart_finance')

    # Konfigurasi OAuth 2.0 (Isi Client ID & Secret dari Console masing-masing)
    GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
    GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')

    FACEBOOK_CLIENT_ID = os.environ.get('FACEBOOK_CLIENT_ID', '')
    FACEBOOK_CLIENT_SECRET = os.environ.get('FACEBOOK_CLIENT_SECRET', '')

    APPLE_CLIENT_ID = os.environ.get('APPLE_CLIENT_ID', '')
    APPLE_CLIENT_SECRET = os.environ.get('APPLE_CLIENT_SECRET', '')
