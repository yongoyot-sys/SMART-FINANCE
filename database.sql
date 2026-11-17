CREATE DATABASE IF NOT EXISTS smart_finance CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_finance;

-- 1. Tabel Pengguna (Mendukung Email/Password & OAuth Google/Facebook/Apple)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    auth_provider ENUM('email', 'google', 'facebook', 'apple') DEFAULT 'email',
    provider_id VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabel Dompet (Multiple Wallets - Menggunakan UUID dari IndexedDB)
CREATE TABLE IF NOT EXISTS wallets (
    id VARCHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    balance DECIMAL(15, 2) DEFAULT 0.00,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Tabel Transaksi (Pemasukan & Pengeluaran)
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    wallet_id VARCHAR(64) NOT NULL,
    type ENUM('income', 'expense') NOT NULL,
    expense_type VARCHAR(50) NULL,
    category VARCHAR(100) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    date DATE NOT NULL,
    note TEXT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Tabel Target Tabungan (Saving Goals)
CREATE TABLE IF NOT EXISTS savings (
    id VARCHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(150) NOT NULL,
    target_amount DECIMAL(15, 2) NOT NULL,
    current_amount DECIMAL(15, 2) DEFAULT 0.00,
    deadline DATE NOT NULL,
    reminder VARCHAR(30) DEFAULT 'none',
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 5. Tabel Anggaran Bulanan (Monthly Budgets)
CREATE TABLE IF NOT EXISTS budgets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    category VARCHAR(100) NOT NULL,
    monthly_limit DECIMAL(15, 2) NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY unique_user_category (user_id, category),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
