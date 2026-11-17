from datetime import datetime
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from authlib.integrations.flask_client import OAuth
from config import Config
from database.connection import get_db_connection

app = Flask(__name__)
app.config.from_object(Config)

# ==========================================================================
# KONFIGURASI OAUTH 2.0 (GOOGLE, FACEBOOK, APPLE)
# ==========================================================================
oauth = OAuth(app)

google = oauth.register(
    name='google',
    client_id=Config.GOOGLE_CLIENT_ID,
    client_secret=Config.GOOGLE_CLIENT_SECRET,
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'}
)

facebook = oauth.register(
    name='facebook',
    client_id=Config.FACEBOOK_CLIENT_ID,
    client_secret=Config.FACEBOOK_CLIENT_SECRET,
    access_token_url='https://graph.facebook.com/oauth/access_token',
    authorize_url='https://www.facebook.com/dialog/oauth',
    api_base_url='https://graph.facebook.com/',
    client_kwargs={'scope': 'email public_profile'}
)

apple = oauth.register(
    name='apple',
    client_id=Config.APPLE_CLIENT_ID,
    client_secret=Config.APPLE_CLIENT_SECRET,
    server_metadata_url='https://appleid.apple.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'name email'}
)

# Helper: Konversi ISO Timestamp dari JS ke format DATETIME MySQL
def parse_iso_datetime(iso_str):
    if not iso_str:
        return datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    return iso_str.replace('T', ' ').split('.')[0].replace('Z', '')

# Helper: Simpan atau Perbarui Entitas dari IndexedDB ke MySQL
def upsert_entity(cursor, user_id, entity, item):
    updated_at = parse_iso_datetime(item.get('updated_at'))

    if entity == 'wallets':
        cursor.execute("""
            INSERT INTO wallets (id, user_id, name, type, balance, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name), type = VALUES(type),
                balance = VALUES(balance), updated_at = VALUES(updated_at)
        """, (item['id'], user_id, item['name'], item['type'], item['balance'], updated_at))

    elif entity == 'transactions':
        cursor.execute("""
            INSERT INTO transactions (id, user_id, wallet_id, type, expense_type, category, amount, date, note, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                wallet_id = VALUES(wallet_id), type = VALUES(type),
                expense_type = VALUES(expense_type), category = VALUES(category),
                amount = VALUES(amount), date = VALUES(date),
                note = VALUES(note), updated_at = VALUES(updated_at)
        """, (
            item['id'], user_id, item['wallet_id'], item['type'],
            item.get('expense_type'), item['category'], item['amount'],
            item['date'], item.get('note', ''), updated_at
        ))

    elif entity == 'savings':
        cursor.execute("""
            INSERT INTO savings (id, user_id, title, target_amount, current_amount, deadline, reminder, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                title = VALUES(title), target_amount = VALUES(target_amount),
                current_amount = VALUES(current_amount), deadline = VALUES(deadline),
                reminder = VALUES(reminder), updated_at = VALUES(updated_at)
        """, (
            item['id'], user_id, item['title'], item['target_amount'],
            item.get('current_amount', 0), item['deadline'],
            item.get('reminder', 'none'), updated_at
        ))

    elif entity == 'budgets':
        cursor.execute("""
            INSERT INTO budgets (user_id, category, monthly_limit, updated_at)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                monthly_limit = VALUES(monthly_limit), updated_at = VALUES(updated_at)
        """, (user_id, item['category'], item['limit'], updated_at))

# ==========================================================================
# 1. HALAMAN UTAMA SPA & SERVICE WORKER SCOPE
# ==========================================================================
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/static/service-worker.js')
def service_worker():
    response = send_from_directory('static', 'service-worker.js')
    response.headers['Service-Worker-Allowed'] = '/'
    return response

# ==========================================================================
# 2. AUTENTIKASI EMAIL & PENGGABUNGAN AKUN TAMU (ACCOUNT MERGING)
# ==========================================================================
@app.route('/api/auth/register', methods=['POST'])
def api_register():
    data = request.get_json()
    full_name = data.get('name', '').strip()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    guest_data = data.get('guest_data', {})

    if not full_name or not email or len(password) < 8:
        return jsonify({'message': 'Lengkapi nama, email, dan kata sandi minimal 8 karakter.'}), 400

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    try:
        cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cursor.fetchone():
            return jsonify({'message': 'Email sudah terdaftar. Silakan masuk.'}), 409

        pw_hash = generate_password_hash(password)
        cursor.execute(
            "INSERT INTO users (full_name, email, password_hash, auth_provider) VALUES (%s, %s, %s, 'email')",
            (full_name, email, pw_hash)
        )
        user_id = cursor.lastrowid

        # Gabungkan seluruh data lokal Mode Tamu ke akun baru ini
        for entity in ['wallets', 'transactions', 'savings', 'budgets']:
            for item in guest_data.get(entity, []):
                upsert_entity(cursor, user_id, entity, item)

        conn.commit()
        session['user_id'] = user_id
        session['user_name'] = full_name
        return jsonify({'message': 'Registrasi & migrasi data berhasil.', 'name': full_name}), 201

    except Exception as e:
        conn.rollback()
        return jsonify({'message': f'Terjadi kesalahan server: {str(e)}'}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM users WHERE email = %s AND auth_provider = 'email'", (email,))
    user = cursor.fetchone()
    cursor.close()
    conn.close()

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'message': 'Email atau kata sandi tidak cocok.'}), 401

    session['user_id'] = user['id']
    session['user_name'] = user['full_name']
    return jsonify({'message': 'Login berhasil', 'name': user['full_name']}), 200

# ==========================================================================
# 3. RUTE OAUTH 2.0 (GOOGLE, FACEBOOK, APPLE)
# ==========================================================================
@app.route('/auth/<provider>')
def oauth_login(provider):
    if provider not in ['google', 'facebook', 'apple']:
        return redirect(url_for('index'))
    redirect_uri = url_for('oauth_callback', provider=provider, _external=True)
    return oauth.create_client(provider).authorize_redirect(redirect_uri)

@app.route('/auth/<provider>/callback')
def oauth_callback(provider):
    client = oauth.create_client(provider)
    token = client.authorize_access_token()

    if provider == 'google':
        user_info = token.get('userinfo') or client.get('https://openidconnect.googleapis.com/v1/userinfo').json()
        email = user_info.get('email')
        name = user_info.get('name', 'Pengguna Google')
        provider_id = user_info.get('sub')
    elif provider == 'facebook':
        user_info = client.get('me?fields=id,name,email').json()
        email = user_info.get('email') or f"{user_info.get('id')}@facebook.local"
        name = user_info.get('name', 'Pengguna Facebook')
        provider_id = user_info.get('id')
    else:  # Apple
        user_info = token.get('userinfo', {})
        email = user_info.get('email', f"{user_info.get('sub')}@apple.local")
        name = 'Pengguna Apple'
        provider_id = user_info.get('sub')

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM users WHERE email = %s", (email,))
    user = cursor.fetchone()

    if not user:
        cursor.execute(
            "INSERT INTO users (full_name, email, auth_provider, provider_id) VALUES (%s, %s, %s, %s)",
            (name, email, provider, provider_id)
        )
        conn.commit()
        user_id = cursor.lastrowid
    else:
        user_id = user['id']
        name = user['full_name']

    cursor.close()
    conn.close()

    session['user_id'] = user_id
    session['user_name'] = name
    return f"""
    <script>
        localStorage.setItem('sf_auth_mode', 'account');
        localStorage.setItem('sf_user_name', {name!r});
        window.location.href = '/';
    </script>
    """

# ==========================================================================
# 4. API SINKRONISASI OFFLINE -> CLOUD MYSQL (/api/sync)
# ==========================================================================
@app.route('/api/sync', methods=['POST'])
def api_sync():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'message': 'Sesi tidak aktif atau mode tamu.'}), 401

    data = request.get_json()
    queue = data.get('queue', [])

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        for task in queue:
            action = task.get('action')
            entity = task.get('entity')
            payload = task.get('payload', {})

            if action == 'UPSERT':
                upsert_entity(cursor, user_id, entity, payload)
            elif action == 'DELETE' and entity in ['wallets', 'transactions', 'savings']:
                cursor.execute(f"DELETE FROM {entity} WHERE id = %s AND user_id = %s", (payload.get('id'), user_id))

        conn.commit()
        return jsonify({'status': 'synced', 'processed': len(queue)}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({'message': str(e)}), 500
    finally:
        cursor.close()
        conn.close()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
