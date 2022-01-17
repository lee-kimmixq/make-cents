CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT, password TEXT);
CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY, category TEXT);
CREATE TABLE IF NOT EXISTS users_categories (id SERIAL PRIMARY KEY, uc_user INTEGER, uc_category INTEGER);
CREATE TABLE IF NOT EXISTS expenses (id SERIAL PRIMARY KEY, exp_user INTEGER, exp_category INTEGER, exp_date DATE, exp_name TEXT, exp_amount FLOAT, exp_is_deleted BOOLEAN DEFAULT false);