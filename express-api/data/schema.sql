-- Filspresso Next Database Schema (PostgreSQL)
-- Optimized for PostgreSQL with pgvector and rdkit extensions

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS rdkit;

-- =============================================================================
-- ACCOUNTS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    icon VARCHAR(255) DEFAULT '/images/default-avatar.png',
    subscription_id INTEGER,
    role VARCHAR(20) DEFAULT 'user', -- admin, user
    graph_theme VARCHAR(20) DEFAULT 'classic',
    email_verified BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_accounts_email ON accounts(email);
CREATE INDEX idx_accounts_username ON accounts(username);

-- =============================================================================
-- USER CARDS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_cards (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    card_number_encrypted VARCHAR(512) NOT NULL,
    card_expiry_encrypted VARCHAR(128) NOT NULL,
    card_cvv_encrypted VARCHAR(255),
    card_holder VARCHAR(255) NOT NULL,
    card_type VARCHAR(50) DEFAULT 'visa',
    card_last_four CHAR(4) NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_cards_account ON user_cards(account_id);

-- =============================================================================
-- ORDERS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    order_number VARCHAR(50) NOT NULL UNIQUE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, confirmed, processing, shipped, delivered, cancelled
    subtotal DECIMAL(10,2) NOT NULL,
    shipping_cost DECIMAL(10,2) DEFAULT 0.00,
    tax DECIMAL(10,2) DEFAULT 0.00,
    total DECIMAL(10,2) NOT NULL,
    shipping_address JSONB,
    billing_address JSONB,
    payment_method VARCHAR(50),
    card_id INTEGER REFERENCES user_cards(id) ON DELETE SET NULL,
    notes TEXT,
    weather_condition VARCHAR(20) DEFAULT 'normal', -- clear, rain, snow, normal
    estimated_delivery VARCHAR(20) DEFAULT '1-2 days',
    expected_delivery_date DATE NULL,
    discount_tier VARCHAR(50),
    discount_percent DECIMAL(5,2) DEFAULT 0.00,
    discount_amount DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_account ON orders(account_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at);

-- =============================================================================
-- ORDER ITEMS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_type VARCHAR(20) NOT NULL, -- capsule, machine, accessory, subscription, service
    product_id VARCHAR(100) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_image VARCHAR(500),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_type, product_id);

-- =============================================================================
-- CHAT SESSIONS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS chat_sessions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    session_uuid VARCHAR(36) NOT NULL UNIQUE,
    title VARCHAR(255) DEFAULT 'New Chat',
    model_type VARCHAR(20) NOT NULL DEFAULT 'tanka_semantic', -- tanka_semantic, tanka_chemistry
    ai_enabled BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    message_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chat_sessions_account ON chat_sessions(account_id);
CREATE INDEX idx_chat_sessions_uuid ON chat_sessions(session_uuid);

-- =============================================================================
-- CHAT MESSAGES TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL, -- user, assistant, system
    content TEXT NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    response_time_ms INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created ON chat_messages(created_at);

-- =============================================================================
-- IOT COMMANDS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS iot_commands (
    id SERIAL PRIMARY KEY,
    machine_id VARCHAR(255) NOT NULL,
    recipe JSONB NOT NULL,
    execute_allowed BOOLEAN DEFAULT TRUE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    meta JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_iot_commands_machine_status ON iot_commands(machine_id, status, created_at);
CREATE INDEX idx_iot_commands_status_created ON iot_commands(status, created_at);

-- =============================================================================
-- USER SESSIONS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_account ON user_sessions(account_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);

-- =============================================================================
-- CART TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS cart_items (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    product_type VARCHAR(20) NOT NULL, -- capsule, machine, accessory
    product_id VARCHAR(100) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_image VARCHAR(500),
    unit_price DECIMAL(10,2) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, product_type, product_id)
);

CREATE INDEX idx_cart_items_account ON cart_items(account_id);

-- =============================================================================
-- MEMBER STATUS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS member_status (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    total_capsules INTEGER DEFAULT 0,
    original_capsules INTEGER DEFAULT 0,
    vertuo_capsules INTEGER DEFAULT 0,
    current_tier VARCHAR(50) DEFAULT 'None',
    highest_tier_achieved VARCHAR(50) DEFAULT 'None',
    current_year_capsules INTEGER DEFAULT 0,
    current_year_start DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_member_status_account ON member_status(account_id);

-- =============================================================================
-- FAVORITES TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS favorites (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    product_type VARCHAR(20) NOT NULL, -- capsule, machine
    product_category VARCHAR(50), -- Original, Vertuo, etc.
    product_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, product_type, product_id)
);

CREATE INDEX idx_favorites_account ON favorites(account_id);

-- =============================================================================
-- MEMBER STATUS HISTORY TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS member_status_history (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    capsules_ordered INTEGER DEFAULT 0,
    original_capsules INTEGER DEFAULT 0,
    vertuo_capsules INTEGER DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    highest_tier VARCHAR(50) DEFAULT 'None',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, year)
);

CREATE INDEX idx_member_status_history_account ON member_status_history(account_id);

-- =============================================================================
-- REPAIRS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS repairs (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    machine_id VARCHAR(100) NOT NULL,
    machine_name VARCHAR(255) NOT NULL,
    repair_type VARCHAR(100) NOT NULL,
    is_warranty BOOLEAN DEFAULT FALSE,
    estimated_cost DECIMAL(10,2) DEFAULT 0.00,
    estimated_duration INTEGER DEFAULT 0, -- in days
    weather_delay BOOLEAN DEFAULT FALSE,
    warranty_delay BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'pending', -- pending, in_progress, completed, shipped, delivered
    pickup_date TIMESTAMP NULL,
    payment_card_id INTEGER REFERENCES user_cards(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_repairs_account ON repairs(account_id);
CREATE INDEX idx_repairs_status ON repairs(status);

-- =============================================================================
-- WEATHER CACHE TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS weather_cache (
    id SERIAL PRIMARY KEY,
    cache_key VARCHAR(100) UNIQUE NOT NULL, -- "lat:lon"
    data JSONB NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- AI COFFEE FACTS TABLE (pgvector)
-- =============================================================================
CREATE TABLE IF NOT EXISTS coffee_facts (
    id SERIAL PRIMARY KEY,
    fact TEXT NOT NULL,
    embedding vector(384),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- SUBSCRIPTIONS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    description TEXT,
    price_ron DECIMAL(10,2) DEFAULT 0.00,
    features JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Internal link for triggers
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default subscriptions
INSERT INTO subscriptions (name, description, price_ron, features) VALUES
('Basic', '10 capsules per month + Kafelot AI access', 55.99, '["10 capsules par mois", "Espressor Essenza Mini Piano Noir C30", "Kafelot Tanka - 50 prompts/month", "5-conversation memory"]'),
('Plus', '30 capsules per month + enhanced AI', 109.99, '["30 capsules par mois", "Espressor Essenza Mini Piano Noir C30", "Kafelot Tanka - 100 prompts/month", "20-conversation memory"]'),
('Pro', '60 capsules per month + CLIP image search', 169.99, '["60 capsules par mois", "Espressor Vertuo Next C Rouge Cerise", "Kafelot Tanka - 150 prompts/month", "50-conversation memory", "CLIP Image Search - 10 queries/month"]'),
('Max', '120 capsules per month + premium AI', 279.99, '["120 capsules par mois", "Espressor Vertuo Next C Rouge Cerise", "Kafelot Tanka - 300 prompts/month", "100-conversation memory", "CLIP Image Search - 25 queries/month"]'),
('Ultimate', '200 capsules per month + full AI suite', 599.99, '["200 capsules par mois", "Espressor Gran Lattissima Noir Élégant", "Kafelot Tanka - 1000 prompts/month", "200-conversation memory", "CLIP Image Search - 50 queries/month", "Molecule Helper (MolScribe AI)"]')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- USER SUBSCRIPTIONS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    plan_id VARCHAR(255) NULL,
    subscription_tier VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, canceled, expired
    billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly', -- monthly, yearly
    price_ron DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    renewal_date DATE NULL,
    end_date DATE NULL,
    auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    card_id INTEGER NULL REFERENCES user_cards(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_subscriptions_account ON user_subscriptions(account_id);
CREATE INDEX idx_user_subscriptions_active ON user_subscriptions(is_active);

-- =============================================================================
-- PRODUCTS TABLES (Coffee & Machines)
-- =============================================================================
CREATE TABLE IF NOT EXISTS coffee_products (
    id SERIAL PRIMARY KEY,
    product_id VARCHAR(100) NOT NULL UNIQUE,
    product_type VARCHAR(20) NOT NULL, -- original, vertuo
    category VARCHAR(255) NOT NULL DEFAULT 'General',
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    stock INTEGER NOT NULL DEFAULT 100,
    description TEXT NULL,
    notes JSONB NULL,
    servings JSONB NULL,
    intensity SMALLINT NULL,
    image_filename VARCHAR(255) NULL,
    image_extension VARCHAR(10) NOT NULL DEFAULT 'png',
    image_style VARCHAR(255) NULL,
    price_class VARCHAR(50) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_coffee_products_id ON coffee_products(product_id);
CREATE INDEX idx_coffee_products_type ON coffee_products(product_type);
CREATE INDEX idx_coffee_products_category ON coffee_products(category);

CREATE TABLE IF NOT EXISTS machine_products (
    id SERIAL PRIMARY KEY,
    product_id VARCHAR(150) NOT NULL UNIQUE,
    product_type VARCHAR(20) NOT NULL, -- original, vertuo
    category VARCHAR(255) NOT NULL DEFAULT 'General',
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    stock INTEGER NOT NULL DEFAULT 10,
    description TEXT NULL,
    notes JSONB NULL,
    image VARCHAR(255) NULL,
    box_class VARCHAR(255) NULL,
    wrapper_class VARCHAR(255) NULL,
    unit_label VARCHAR(255) NULL,
    price_class VARCHAR(50) NULL,
    price_text VARCHAR(255) NULL,
    extra_class JSONB NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_machine_products_id ON machine_products(product_id);
CREATE INDEX idx_machine_products_type ON machine_products(product_type);
CREATE INDEX idx_machine_products_category ON machine_products(category);

-- =============================================================================
-- MOLECULES TABLE (rdkit)
-- =============================================================================
CREATE TABLE IF NOT EXISTS molecules (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    smiles TEXT NOT NULL,
    molecule mol,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_molecules_mol ON molecules USING gist(molecule);

-- =============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_cards_updated_at BEFORE UPDATE ON user_cards FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_chat_sessions_updated_at BEFORE UPDATE ON chat_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_iot_commands_updated_at BEFORE UPDATE ON iot_commands FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_cart_items_updated_at BEFORE UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_subscriptions_updated_at BEFORE UPDATE ON user_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_coffee_products_updated_at BEFORE UPDATE ON coffee_products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_machine_products_updated_at BEFORE UPDATE ON machine_products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_member_status_updated_at BEFORE UPDATE ON member_status FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_member_status_history_updated_at BEFORE UPDATE ON member_status_history FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_repairs_updated_at BEFORE UPDATE ON repairs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- INITIAL DATA
-- =============================================================================

-- Admin User (Password: 'FilspressoNext')
INSERT INTO accounts (username, email, password_hash, role, name) VALUES
('Admin', 'admin@filspresso.com', '$2b$12$W09GNFA6uYG9t/TJzd9ppOyXOcqifjTG17/slLpHqyBoqA9fNnagm', 'admin', 'Administrator')
ON CONFLICT (username) DO NOTHING;

-- Coffee Products
INSERT INTO coffee_products (product_id, product_type, category, name, price, stock, description, notes, servings, intensity, image_filename, image_extension, image_style, price_class) VALUES
('dharkan', 'original', 'Édition Limitée', 'Dharkan', 55, 100, 'Notes de torréfaction intense et de cacao.', '["Torréfaction","Intense","Cacao"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 11, 'Dharkan', 'avif', '', 'bag_group'),
('espresso-noir-festif', 'original', 'Édition Limitée', 'Espresso noir festif', 47.5, 100, 'Notes boisées et épicées.', '["Boisées","Épicées"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 9, 'Festive Black Espresso', 'avif', '', 'bag_group_5'),
('-pices-d-lices-de-saison', 'original', 'Édition Limitée', 'Épices délices de saison', 47.5, 100, 'Arôme naturel de vin et d''épices.', '["Naturel","Vin","Épices"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 8, 'Seasonal Delight Spices', 'avif', '', 'bag_group_6'),
('no20', 'original', 'Édition Limitée', 'No20', 135, 100, 'Un café d''exception aux notes fraîches d''agrumes, cultivé au cœur d''un terroir montagneux et luxuriant.', '["Exception","Fraîches","Agrumes","Cultivé"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 7, 'No20', 'avif', 'scale: 0.9; margin-top: 0;', 'bag_group_6'),
('galapagos', 'original', 'Édition Limitée', 'Galapagos', 80, 100, 'Un café rare, cultivé sur des sols riches en biodiversité.', '["Rare","Cultivé","Sols","Riches"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 7, 'Galapagos', 'avif', 'scale: 0.9; margin-top: 0;', 'bag_group'),
('hawaii-kona', 'original', 'Édition Limitée', 'Hawaii Kona', 80, 100, 'Un café très rare cultivé sur les pentes d''un volcan.', '["Très","Rare","Cultivé","Pentes"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 7, 'Hawaii Kona', 'avif', 'scale: 0.95; margin-top: 0;', 'bag_group'),
('almond-croissant-flavor', 'original', 'Édition Limitée', 'Almond Croissant Flavor', 67.5, 100, 'Un café au goût naturel d''amande et de vanille, avec des notes de caramel.', '["Naturel","Amande","Vanille","Caramel"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 7, 'Almond Croissant Flavour', 'avif', 'scale: 0.9; margin-top: 0;', 'bag_group_3'),
('peanut-and-roasted-sesame-flavour', 'original', 'Édition Limitée', 'Peanut and Roasted Sesame Flavour', 67.5, 100, 'Un café au goût naturel de cacahuète et de sésame torréfié.', '["Naturel","Cacahuète","Sésame","Torréfié"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 7, 'Peanut and Roasted Sesame Flavour', 'avif', 'scale: 0.9; margin-top: 0;', 'bag_group_3'),
('unforgettable-espresso', 'original', 'Édition Limitée', 'Unforgettable Espresso', 67.5, 100, 'Un café intense aux notes de céréales toastées et boisées.', '["Intense","Céréales","Toastées","Boisées"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 7, 'Unforgettable Espresso', 'avif', 'scale: 0.9; margin-top: 0;', 'bag_group_6'),
('capriccio', 'original', 'Espresso', 'Capriccio', 24.5, 100, 'Un café affirmé, avec une fine acidité. Notes de céréales.', '["Affirmé","Fine","Acidité","Céréales"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 11, 'Capriccio', 'avif', '', 'bag_group_2'),
('cosi', 'original', 'Espresso', 'Cosi', 24.5, 100, 'Équilibré and délicatement torréfié.', '["Équilibré","Délicatement","Torréfié"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 6, 'Cosi', 'avif', '', 'bag_group'),
('volutto', 'original', 'Espresso', 'Volutto', 24.5, 100, 'Doux and léger with des notes de céréales and de fruits.', '["Doux","Léger","Céréales","Fruits"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 10, 'Volluto', 'avif', '', 'bag_group'),
('volutto-decaffeinato', 'original', 'Espresso', 'Volutto Decaffeinato', 25.5, 100, 'Doux and léger with des notes de céréales and de fruits, décaféiné.', '["Doux","Léger","Céréales","Fruits"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 13, 'Volluto Decaffeinato', 'avif', '', 'bag_group_2'),
('kazaar', 'original', 'Ispirazione Italiana', 'Kazaar', 22, 100, 'Intense and sirupeux - Notes intenses and épicées.', '["Intense","Sirupeux","Intenses","Épicées"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 11, 'Kazaar', 'avif', '', 'bag_group'),
('livanto', 'original', 'Ispirazione Italiana', 'Livanto', 22, 100, 'Rond and équilibré - Notes caramel.', '["Rond","Équilibré","Caramel"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 6, 'Livanto', 'avif', '', 'bag_group'),
('ristretto', 'original', 'Ispirazione Italiana', 'Ristretto', 22, 100, 'Fort and contrasté - Notes grillées and fruitées.', '["Fort","Contrasté","Grillées","Fruitées"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 10, 'Ristretto', 'webp', '', 'bag_group'),
('inspirazione-napoli', 'original', 'Ispirazione Italiana', 'Inspirazione Napoli', 22, 100, 'L’assortiment le plus intense – Notes de torréfaction and de cacao.', '["Assortiment","Plus","Intense","Torréfaction"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 13, 'Ispirazione Napoli', 'webp', '', 'bag_group_2'),
('inspirazione-roma', 'original', 'Ispirazione Italiana', 'Inspirazione Roma', 22, 100, 'Plein and équilibré - Notes boisées and granuleuses.', '["Plein","Équilibré","Boisées","Granuleuses"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 8, 'Ispirazione Roma', 'avif', '', 'bag_group'),
('inspirazione-venezia', 'original', 'Ispirazione Italiana', 'Inspirazione Venezia', 22, 100, 'Equilibré and corsé - Notes caramel, céréales and florales.', '["Equilibré","Corsé","Caramel","Céréales"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 8, 'Ispirazione Venezia', 'avif', '', 'bag_group'),
('arpeggio', 'original', 'Ispirazione Italiana', 'Arpeggio', 22, 100, 'Intense and crémeux - Notes grillées and cacaotées.', '["Intense","Crémeux","Grillées","Cacaotées"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 9, 'Arpeggio', 'webp', '', 'bag_group'),
('ispirazione-palermo', 'original', 'Italian Explorations', 'Ispirazione Palermo', 28.5, 100, 'Un espresso corsé dans une capsule compostable.', '["Corsé","Compostable"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 11, 'Ispirazione Palermo', 'avif', 'scale: 0.8; margin-top: 0%;', 'bag_group'),
('ispirazione-sicilia', 'original', 'Italian Explorations', 'Ispirazione Sicilia', 28.5, 100, 'Un café noir and intense dans une capsule compostable.', '["Noir","Intense","Compostable"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 6, 'Ispirazione Sicilia', 'avif', 'scale: 0.8; margin-top: 0%', 'bag_group'),
('ispirazione-aosta', 'original', 'Italian Explorations', 'Ispirazione Aosta', 28.5, 100, 'Un espresso doux and équilibré dans une capsule compostable.', '["Doux","Équilibré","Compostable"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 10, 'Ispirazione Aosta', 'avif', 'scale: 0.8; margin-top: 0%', 'bag_group_2'),
('inspirazione-emilia', 'original', 'Italian Explorations', 'Inspirazione Emilia', 28.5, 100, 'Un espresso riche and intense dans une capsule compostable.', '["Riche","Intense","Compostable"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 13, 'Ispirazione Emilia', 'avif', 'scale: 0.8; margin-top: 0%', 'bag_group_2'),
('decaffeinato', 'original', 'Italian Explorations', 'Decaffeinato', 29.5, 100, 'Un espresso décaféiné and intense dans une capsule compostable.', '["Décaféiné","Intense","Compostable"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 8, 'Decaffeinato', 'avif', 'scale: 0.8; margin-top: 0%', 'bag_group_2'),
('peru-organic', 'original', 'Italian Explorations', 'Peru Organic', 32, 100, 'Un café biologique dans une capsule compostable.', '["Biologique","Compostable"]', '[{"icon":"images/svg/ristretto.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 8, 'Peru Organic', 'avif', 'scale: 0.8; margin-top: 0%', 'bag_group'),
('caramello', 'original', 'Créations Barista', 'Caramello', 25.5, 100, 'Arôme naturel de caramel and de biscuit.', '["Naturel","Caramel","Biscuit"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 7, 'Caramello', 'avif', '', 'bag_group'),
('chiaro', 'original', 'Créations Barista', 'Chiaro', 24.5, 100, 'Pour des recettes sucrées with du lait.', '["Recettes","Sucrées","Lait"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 9, 'Chiaro', 'avif', '', 'bag_group'),
('cioccolatino', 'original', 'Créations Barista', 'Cioccolatino', 25.5, 100, 'Arôme naturel de chocolat, céréales and biscuits.', '["Naturel","Chocolat","Céréales","Biscuits"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 8, 'Cioccolatino', 'avif', '', 'bag_group'),
('corto', 'original', 'Créations Barista', 'Corto', 24.5, 100, 'Pour des recettes intensives with du lait.', '["Recettes","Intensives","Lait"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 10, 'Corto', 'avif', '', 'bag_group'),
('nocciola', 'original', 'Créations Barista', 'Nocciola', 25.5, 100, 'Arôme naturel de noisettes and pralines.', '["Naturel","Noisettes","Pralines"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 8, 'Nocciola', 'avif', '', 'bag_group'),
('scuro', 'original', 'Créations Barista', 'Scuro', 24.5, 100, 'Pour des recettes équilibrées with du lait.', '["Recettes","Équilibrées","Lait"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 11, 'Scuro', 'webp', '', 'bag_group'),
('vanille', 'original', 'Créations Barista', 'Vanille', 25.5, 100, 'Arôme naturel de vanille, biscuit and céréales.', '["Naturel","Vanille","Biscuit","Céréales"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 9, 'Vaniglia', 'avif', '', 'bag_group'),
('buenos-aires-lungo', 'original', 'Explorations du Monde', 'Buenos Aires Lungo', 24.5, 100, 'Doux and distinct - Notes céréalières.', '["Doux","Distinct","Céréalières"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 4, 'Buenos Aires Lungo', 'avif', '', 'bag_group'),
('cape-town-lungo', 'original', 'Explorations du Monde', 'Cape Town Lungo', 24.5, 100, 'Fort and amer - Notes boisées.', '["Fort","Amer","Boisées"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 10, 'Cape Town Lungo', 'webp', '', 'bag_group'),
('istanbul-espresso', 'original', 'Explorations du Monde', 'Istanbul Espresso', 23, 100, 'Une intersection de saveurs - Notes grillées légèrement fruitées.', '["Intersection","Grillées","Légèrement","Fruitées"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 8, 'Istanbul Espresso', 'webp', '', 'bag_group_2'),
('paris-espresso', 'original', 'Explorations du Monde', 'Paris Espresso', 23, 100, 'Café Culture - Notes de céréales and de biscuits, with un subtil arôme d''agrumes.', '["Culture","Céréales","Biscuits","Subtil"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 6, 'Paris Espresso', 'avif', '', 'bag_group_2'),
('rio-de-janeiro-espresso', 'original', 'Explorations du Monde', 'Rio de Janeiro Espresso', 23, 100, 'Une palette aromatique complète - Notes d''herbes aromatiques.', '["Palette","Aromatique","Complète","Herbes"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"}]', 9, 'Rio de Janeiro Espresso', 'webp', '', 'bag_group_3'),
('shanghai-lungo', 'original', 'Explorations du Monde', 'Shanghai Lungo', 24.5, 100, 'Fruité and onctueux - Notes de baies.', '["Fruité","Onctueux","Baies"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 5, 'Shanghai Lungo', 'webp', '', 'bag_group'),
('stockholm-lungo', 'original', 'Explorations du Monde', 'Stockholm Lungo', 24.5, 100, 'Raffiné and corsé - Notes de céréales sucrées and de malt.', '["Raffiné","Corsé","Céréales","Sucrées"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 8, 'Stockholm Lungo', 'webp', '', 'bag_group'),
('tokyo-lungo', 'original', 'Explorations du Monde', 'Tokyo Lungo', 24.5, 100, 'Gouttes d''élégance - Notes florales and fruitées.', '["Gouttes","Élégance","Florales","Fruitées"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 6, 'Tokyo Lungo', 'webp', '', 'bag_group'),
('vienna-lungo', 'original', 'Explorations du Monde', 'Vienna Lungo', 24.5, 100, 'Equilibré and raffiné - Notes de malt.', '["Equilibré","Raffiné","Malt"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 6, 'Vienna Lungo', 'avif', '', 'bag_group'),
('kahawa-ya-congo-organic', 'original', 'Origines Principales', 'Kahawa ya Congo Organic', 42.5, 100, 'Café biologique doux and fruité. Notes de céréales grillées and noix.', '["Biologique","Doux","Fruité","Céréales"]', '[{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 7, 'Kahawa ya Congo Organic', 'avif', '', 'bag_group_3'),
('zambia', 'original', 'Origines Principales', 'Zambia', 34.5, 100, 'Un café inspiré par la gastronomie aux notes de fruits mürs and de céréales.', '["Inspiré","Gastronomie","Fruits","Mürs"]', '[{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 7, 'Zambia', 'avif', 'scale: 0.84; margin-top: 0;', 'bag_group_2'),
('colombia', 'original', 'Origines Principales', 'Colombia', 24.9, 100, 'Aux Arabica récoltés tardivement - Notes de fruits rouges and de forêt.', '["Arabica","Récoltés","Tardivement","Fruits"]', '[{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 6, 'Colombia', 'webp', '', 'bag_group_2'),
('ethiopia', 'original', 'Origines Principales', 'Ethiopia', 24.9, 100, 'À l''Arabica de transformation tardive - Notes de fleur d''oranger and de confiture de fruits.', '["Arabica","Transformation","Tardive","Fleur"]', '[{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 4, 'Ethiopia', 'avif', '', 'bag_group_4'),
('india', 'original', 'Origines Principales', 'India', 24.9, 100, 'Robusta exposé aux vents de mousson - Notes épicées.', '["Robusta","Exposé","Vents","Mousson"]', '[{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 11, 'India', 'webp', '', 'bag_group'),
('indonesia', 'original', 'Origines Principales', 'Indonesia', 24.9, 100, 'Arabica pelé humide - Feuille de tabac and notes boisées.', '["Arabica","Pelé","Humide","Feuille"]', '[{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 8, 'Indonesia', 'avif', '', 'bag_group'),
('nicaragua', 'original', 'Origines Principales', 'Nicaragua', 24.9, 100, 'À l''Arabica "Miel Noir" - Notes sucrées de céréales.', '["Arabica","Miel","Noir","Sucrées"]', '[{"icon":"images/svg/espresso.svg","title":"Espresso","volume":"40 ml"},{"icon":"images/svg/lungo.svg","title":"Lungo","volume":"110 ml"}]', 5, 'Nicaragua', 'webp', '', 'bag_group'),
('white-chocolate-and-strawberry-vertuo', 'vertuo', 'Édition Limitée', 'White Chocolate and Strawberry', 88.5, 100, 'Un café aromatisé au délicat parfum de chocolat blanc and de fraise.', '["Aromatisé","Délicat","Parfum","Chocolat"]', '[{"icon":"images/svg/iced vl.svg","title":"Cold-Brew","volume":"Iced"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 8, 'White Chocolate and Strawberry', 'avif', '', 'bag_group_3'),
('peanut-and-roasted-sesame-flavour-vertuo', 'vertuo', 'Édition Limitée', 'Peanut and Roasted Sesame Flavour', 74.9, 100, 'Un café gourmand aromatisé au sésame grillé and à la cacahuète.', '["Gourmand","Aromatisé","Sésame","Grillé"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 11, 'Peanut and Roasted Sesame Flavour', 'avif', 'margin-top: 0', 'bag_group_3'),
('almond-croissant-flavour-vertuo', 'vertuo', 'Édition Limitée', 'Almond Croissant Flavour', 74.9, 100, 'Un café aromatisé au doux parfum d’amande and de vanille, teinté de caramel.', '["Aromatisé","Doux","Parfum","Amande"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 7, 'Almond Croissant Flavour', 'avif', 'margin-top: 0', 'bag_group_3'),
('unforgettable-double-espresso-vertuo', 'vertuo', 'Édition Limitée', 'Unforgettable Double Espresso', 74.9, 100, 'Un café intense aux notes de céréales toastées and boisées.', '["Intense","Céréales","Toastées","Boisées"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 9, 'Unforgettable Double Espresso', 'avif', '', 'bag_group_6'),
('no20-vertuo', 'vertuo', 'Édition Limitée', 'No20', 155, 100, 'Un café d''exception aux notes fraîches d''agrumes, cultivé au coeur d''un terroir montagneux and luxuriant.​', '["Exception","Fraîches","Agrumes","Cultivé"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 8, 'No20', 'avif', '', 'bag_group_6'),
('hawaii-kona-vertuo', 'vertuo', 'Édition Limitée', 'Hawaii Kona', 110, 100, 'Un café très rare cultivé sur les pentes d''un volcan.', '["Très","Rare","Cultivé","Pentes"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 9, 'Hawaii Kona VL', 'avif', '', 'bag_group'),
('ginseng-delight-vertuo', 'vertuo', 'Coffee+', 'Ginseng Delight', 45, 100, 'Café à l''extrait de ginseng and au caramel.', '["Extrait","Ginseng","Caramel"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 5, 'Ginseng Delight', 'avif', '', 'bag_group'),
('melozio-go-vertuo', 'vertuo', 'Coffee+', 'Melozio Go', 49.5, 100, 'Mélange doux and équilibré with un boost de caféine.', '["Mélange","Doux","Équilibré","Boost"]', '[{"icon":"images/svg/iced vl.svg","title":"Cold-Brew","volume":"Iced"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 9, 'Melozio Go', 'avif', '', 'bag_group'),
('stormio-go-vertuo', 'vertuo', 'Coffee+', 'Stormio Go', 49.5, 100, 'Mélange intense with ajout de caféine.', '["Mélange","Intense","Ajout","Caféine"]', '[{"icon":"images/svg/iced vl.svg","title":"Cold-Brew","volume":"Iced"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 6, 'Stormio Go', 'avif', '', 'bag_group'),
('vivida-vertuo', 'vertuo', 'Coffee+', 'Vivida', 49.5, 100, 'Céréales, sucrées and enrichiest.', '["Céréales","Sucrées","Enrichiest"]', '[{"icon":"images/svg/iced vl.svg","title":"Cold-Brew","volume":"Iced"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 7, 'Vivida', 'avif', '', 'bag_group'),
('bianco-doppio-vertuo', 'vertuo', 'Créations Barista', 'Bianco Doppio', 29, 100, 'Notes fruitées and biscuits.', '["Fruitées","Biscuits"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 8, 'Bianco Doppio', 'webp', '', 'bag_group_5'),
('bianco-forte-vertuo', 'vertuo', 'Créations Barista', 'Bianco Forte', 33.9, 100, 'Notes de torréfaction intense and de céréales.', '["Torréfaction","Intense","Céréales"]', '[{"icon":"images/svg/iced vl.svg","title":"Cold-Brew","volume":"Iced"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 11, 'Bianco Forte', 'webp', '', 'bag_group'),
('bianco-piccolo-vertuo', 'vertuo', 'Créations Barista', 'Bianco Piccolo', 27.5, 100, 'Notes de caramel and de biscuits.', '["Caramel","Biscuits"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/espresso vl.svg","title":"Espresso","volume":"40 ml"}]', 7, 'Bianco Piccolo', 'webp', '', 'bag_group'),
('caramel-dor--vertuo', 'vertuo', 'Créations Barista', 'Caramel doré', 36.5, 100, 'Arôme naturel de caramel and de biscuit.', '["Naturel","Caramel","Biscuit"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 9, 'Golden Caramel', 'avif', '', 'bag_group'),
('chocolat-riche-vertuo', 'vertuo', 'Créations Barista', 'Chocolat riche', 36.5, 100, 'Arôme naturel de chocolat.', '["Naturel","Chocolat"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 8, 'Rich Chocolate', 'avif', '', 'bag_group_5'),
('noisettes-grill-es-vertuo', 'vertuo', 'Créations Barista', 'Noisettes grillées', 36.5, 100, 'Arôme naturel de noisettes torréfiées, biscuits and caramel.', '["Naturel","Noisettes","Torréfiées","Biscuits"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 9, 'Roasted Hazelnut', 'avif', '', 'bag_group_2'),
('vanille-douce-vertuo', 'vertuo', 'Créations Barista', 'Vanille Douce', 36.5, 100, 'Arôme naturel de vanille and biscuits sucrés.', '["Naturel","Vanille","Biscuits","Sucrés"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 10, 'Sweet Vanilla', 'avif', '', 'bag_group'),
('vanille-douce-decaffeinato-vertuo', 'vertuo', 'Créations Barista', 'Vanille Douce Decaffeinato', 38, 100, 'Arôme naturel de vanille and biscuits sucrés, décaféiné.', '["Naturel","Vanille","Biscuits","Sucrés"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 10, 'Sweet Vanilla Decaffeinato', 'avif', '', 'bag_group_6'),
('altissio-vertuo', 'vertuo', 'Espressos', 'Altissio', 25.5, 100, 'Corsé and crémeux.', '["Corsé","Crémeux"]', '[{"icon":"images/svg/ristretto vl.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso vl.svg","title":"Espresso","volume":"40 ml"}]', 7, 'Altissio', 'webp', '', 'bag_group_5'),
('diavolitto-vertuo', 'vertuo', 'Espressos', 'Diavolitto', 25.5, 100, 'Très intense and puissant.', '["Très","Intense","Puissant"]', '[{"icon":"images/svg/ristretto vl.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso vl.svg","title":"Espresso","volume":"40 ml"}]', 8, 'Diavolitto', 'webp', '', 'bag_group_5'),
('il-caff--vertuo', 'vertuo', 'Espressos', 'Il caffè', 25.5, 100, 'Particulièrement intense and velouté.', '["Particulièrement","Intense","Velouté"]', '[{"icon":"images/svg/ristretto vl.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso vl.svg","title":"Espresso","volume":"40 ml"}]', 9, 'Il caffe', 'avif', '', 'bag_group'),
('orafio-vertuo', 'vertuo', 'Espressos', 'Orafio', 27.5, 100, 'Caramel and frit.', '["Caramel","Frit"]', '[{"icon":"images/svg/ristretto vl.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso vl.svg","title":"Espresso","volume":"40 ml"}]', 7, 'Orafio', 'webp', '', 'bag_group_5'),
('ristretto-classico-vertuo', 'vertuo', 'Espressos', 'Ristretto Classico', 25.5, 100, 'Notes de torréfaction intense and de baies.', '["Torréfaction","Intense","Baies"]', '[{"icon":"images/svg/ristretto vl.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso vl.svg","title":"Espresso","volume":"40 ml"}]', 8, 'Ristretto Classico', 'avif', '', 'bag_group'),
('ristretto-intenso-vertuo', 'vertuo', 'Espressos', 'Ristretto Intenso', 25.5, 100, 'Notes épicées and boisées.', '["Épicées","Boisées"]', '[{"icon":"images/svg/ristretto vl.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso vl.svg","title":"Espresso","volume":"40 ml"}]', 11, 'Ristretto Intenso', 'avif', '', 'bag_group_5'),
('toccanto-vertuo', 'vertuo', 'Espressos', 'Toccanto', 25.5, 100, 'Fruites de forêt and vin.', '["Fruites","Forêt","Vin"]', '[{"icon":"images/svg/ristretto vl.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso vl.svg","title":"Espresso","volume":"40 ml"}]', 9, 'Toccanto', 'webp', '', 'bag_group_5'),
('voltesso-vertuo', 'vertuo', 'Espressos', 'Voltesso', 25.5, 100, 'Léger and doux.', '["Léger","Doux"]', '[{"icon":"images/svg/ristretto vl.svg","title":"Ristretto","volume":"25 ml"},{"icon":"images/svg/espresso vl.svg","title":"Espresso","volume":"40 ml"}]', 8, 'Voltesso', 'webp', '', 'bag_group_5'),
('double-espresso-scuro-vertuo', 'vertuo', 'Double Espresso', 'Double Espresso Scuro', 35, 100, 'Café à l''arôme intense and audacieux.', '["Intense","Audacieux"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 5, 'Double Espresso Scuro', 'avif', '', 'bag_group_6'),
('double-espresso-dolce-vertuo', 'vertuo', 'Double Espresso', 'Double Espresso Dolce', 35, 100, 'Café aux arômes de céréales and de malt.', '["Céréales","Malt"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 9, 'Double Espresso Dolce', 'avif', '', 'bag_group_6'),
('double-espresso-chiaro-vertuo', 'vertuo', 'Double Espresso', 'Double Espresso Chiaro', 35, 100, 'Café à la texture dense and sauvage.', '["Texture","Dense","Sauvage"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 6, 'Double Espresso Chiaro', 'avif', '', 'bag_group_6'),
('double-espresso-chiaro-decaffeinato-vertuo', 'vertuo', 'Double Espresso', 'Double Espresso Chiaro Decaffeinato', 37, 100, 'Accents boisés and notes de céréales grillées.', '["Accents","Boisés","Céréales","Grillées"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 7, 'Double Espresso Chiaro Decaffeinato', 'avif', '', 'bag_group_6'),
('inizio-vertuo', 'vertuo', 'Gran Lungo', 'Inizio', 37.5, 100, 'Floral and céréales.', '["Floral","Céréales"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/gran lungo.svg","title":"Gran Lungo","volume":"150 ml"}]', 5, 'Inizio', 'avif', '', 'bag_group_5'),
('arondio-vertuo', 'vertuo', 'Gran Lungo', 'Arondio', 37.5, 100, 'Céréales and doux.', '["Céréales","Doux"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/gran lungo.svg","title":"Gran Lungo","volume":"150 ml"}]', 9, 'Arondio', 'avif', '', 'bag_group_5'),
('fortado-vertuo', 'vertuo', 'Gran Lungo', 'Fortado', 37.5, 100, 'Intense and corsé.', '["Intense","Corsé"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/gran lungo.svg","title":"Gran Lungo","volume":"150 ml"}]', 6, 'Fortado', 'avif', '', 'bag_group_5'),
('fortado-decaffeinato-vertuo', 'vertuo', 'Gran Lungo', 'Fortado Decaffeinato', 39, 100, 'Intense and corsé, décaféiné.', '["Intense","Corsé","Décaféiné"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/gran lungo.svg","title":"Gran Lungo","volume":"150 ml"}]', 7, 'Fortado Decaffeinato', 'avif', '', 'bag_group_5'),
('half-caffeinato-vertuo', 'vertuo', 'Tasse', 'Half Caffeinato', 33, 100, 'Doux and velouté.', '["Doux","Velouté"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 5, 'Half Caffeinato', 'avif', '', 'bag_group_5'),
('intenso-vertuo', 'vertuo', 'Tasse', 'Intenso', 36.5, 100, 'Profond and dense.', '["Profond","Dense"]', '[{"icon":"images/svg/iced vl.svg","title":"Cold-Brew","volume":"Iced"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 9, 'Intenso', 'webp', '', 'bag_group_5'),
('melozio-vertuo', 'vertuo', 'Tasse', 'Melozio', 33, 100, 'Délicat and équilibré.', '["Délicat","Équilibré"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 6, 'Melozio', 'avif', '', 'bag_group_5'),
('odacio-vertuo', 'vertuo', 'Tasse', 'Odacio', 33, 100, 'Audacieux and vivant.', '["Audacieux","Vivant"]', '[{"icon":"images/svg/iced vl.svg","title":"Cold-Brew","volume":"Iced"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 7, 'Odacio', 'webp', '', 'bag_group_5'),
('solelio-vertuo', 'vertuo', 'Tasse', 'Solelio', 36.5, 100, 'Arôme fruité and corps léger.', '["Fruité","Corps","Léger"]', '[{"icon":"images/svg/iced vl.svg","title":"Cold-Brew","volume":"Iced"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 2, 'Solelio', 'webp', '', 'bag_group_5'),
('stormio-vertuo', 'vertuo', 'Tasse', 'Stormio', 33, 100, 'Riche and puissant.', '["Riche","Puissant"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 8, 'Stormio', 'webp', '', 'bag_group_5'),
('colombia-vertuo', 'vertuo', 'Origines Principales', 'Colombia', 36.5, 100, 'Notes de pomme confite and de fruits de forêt.', '["Pomme","Confite","Fruits","Forêt"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 5, 'Colombia', 'avif', '', 'bag_group'),
('costa-rica-vertuo', 'vertuo', 'Origines Principales', 'Costa Rica', 34.5, 100, 'Notes sucrées de céréales.', '["Sucrées","Céréales"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 7, 'Costa Rica', 'webp', '', 'bag_group_5'),
('el-salvador-vertuo', 'vertuo', 'Origines Principales', 'El Salvador', 36.5, 100, 'Notes de noix and de confiture de fruits.', '["Noix","Confiture","Fruits"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 5, 'El Salvador', 'avif', '', 'bag_group'),
('ethiopia-vertuo', 'vertuo', 'Origines Principales', 'Ethiopia', 34.5, 100, 'Notes de myrtilles mûres and de musc.', '["Myrtilles","Mûres","Musc"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 4, 'Ethiopia', 'webp', '', 'bag_group'),
('mexico-vertuo', 'vertuo', 'Origines Principales', 'Mexico', 36.5, 100, 'Notes épicées and boisées.', '["Épicées","Boisées"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 7, 'Mexico', 'webp', '', 'bag_group_5'),
('peru-organic-vertuo', 'vertuo', 'Origines Principales', 'Peru Organic', 39.5, 100, 'Notes de fruits and de céréales grillées sucrées.', '["Fruits","Céréales","Grillées","Sucrées"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/espresso vl.svg","title":"Espresso","volume":"40 ml"}]', 6, 'Peru Organic', 'webp', '', 'bag_group'),
('kahawa-ya-congo-organic-vertuo', 'vertuo', 'Origines Principales', 'Kahawa ya Congo Organic', 52.5, 100, 'Un café bio de l''est du Congo aux notes de fruits and de céréales.', '["Bio","Est","Congo","Fruits"]', '[{"icon":"images/svg/reverso.svg","title":"Reverso","volume":"Latte"},{"icon":"images/svg/mug.svg","title":"Mug","volume":"230 ml"}]', 6, 'Kahawa ya Congo Organic', 'avif', '', 'bag_group_3'),
('zambia-vertuo', 'vertuo', 'Origines Principales', 'Zambia', 47.5, 100, 'Un café inspiré par la gastronomie aux notes de fruits mûrs and de céréales.', '["Inspiré","Gastronomie","Fruits","Mûrs"]', '[{"icon":"images/svg/milk recipies.svg","title":"Cappuccino","volume":"Latte"},{"icon":"images/svg/lungo vl.svg","title":"Double Espresso","volume":"80 ml"}]', 6, 'Zambia', 'avif', '', 'bag_group_2'),
('alto-onice-vertuo', 'vertuo', 'Craft Brew', 'Alto Onice', 54.7, 100, 'Trésor caché, torréfié and boisé.', '["Trésor","Caché","Torréfié","Boisé"]', '[{"icon":"images/svg/iced vl.svg","title":"Cold-Brew","volume":"Iced"},{"icon":"images/svg/alto.svg","title":"Alto","volume":"355 ml"}]', 5, 'Alto Onice', 'avif', '', 'bag_group'),
('cold-brew-style-intense-vertuo', 'vertuo', 'Craft Brew', 'Cold-Brew Style Intense', 71.9, 100, 'Pour les recettes de café glacé « Cold-Brew ».', '["Recettes","Glacé","Cold","Brew"]', '[{"icon":"images/svg/iced vl.svg","title":"Cold-Brew","volume":"Iced"},{"icon":"images/svg/alto.svg","title":"Alto","volume":"355 ml"}]', 9, 'Cold Brew Style Intense', 'avif', '', 'bag_group_6'),
('carafe-pour-over-style-intense-vertuo', 'vertuo', 'Craft Brew', 'Carafe Pour-Over Style Intense', 63.7, 100, 'Roasted and smoky - Exclusively for use with Vertuo Next Machine.', '["Roasted","Smoky","Exclusively","For"]', '[{"icon":"images/svg/iced vl.svg","title":"Cold-Brew","volume":"Iced"},{"icon":"images/svg/carafe.svg","title":"Carafe","volume":"535 ml"}]', 6, 'Carafe Pour-Over Style Intense', 'avif', '', 'bag_group_3');

-- Machine Products
INSERT INTO machine_products (product_id, product_type, category, name, price, stock, description, notes, image, box_class, wrapper_class, unit_label, price_class, price_text, extra_class) VALUES
('pack-essenza-mini-c30-blanc-caf-porte-capsule', 'original', 'Forfaits spéciaux', 'Forfait Essenza Mini C30 Blanc, café & porte capsule', 841.4, 10, 'Le paquet contient:', '["-1x Machine à espresso Essenza Mini C30;","-50x capsules de café Original;","-1x Suport des bonbons."]', 'images/Machines/Original/Special Packs/Essenza-Mini-C30-White.avif', 'machine_box', 'machine_groups_models', '50 capsules', 'bag_group', '841,40 RON', '[]'),
('pack-essenza-mini-d30-rouge-caf-porte-capsule', 'original', 'Forfaits spéciaux', 'Forfait Essenza Mini D30 Rouge, café & porte capsule', 631.05, 10, 'Le paquet contient:', '["-1x Machine à espresso Essenza Mini D30;","-50x capsules de café Original;","-1x Suport des bonbons."]', 'images/Machines/Original/Special Packs/Essenza-Mini-D30-Red.avif', 'machine_box', 'machine_groups_models', '50 capsules', 'bag_group', '631,05 RON', '[]'),
('forfait-inissia-black-caf-aeroccino3-porte-capsule', 'original', 'Forfaits spéciaux', 'Forfait Inissia Black, café & Aeroccino 3 & porte capsule', 877.8, 10, 'Le paquet contient:', '["-1x Machine à espresso Innisia Noir;","-70x capsules de café Original;","-1x Aeroccino 3;","-1x Suport des bonbons."]', 'images/Machines/Original/Special Packs/Inissia-Black.avif', 'machine_box', 'machine_groups_models', '70 capsules', 'bag_group_4', '877,80 RON', '[]'),
('espressor-citiz-d113-noir', 'original', 'Espressors', 'Machine à espresso CitiZ D113 Noir', 990, 10, 'Design rétro moderne with des finitions exceptionnelles.', '[]', 'images/Machines/Original/Espresso Machines/CitiZ D113 Noir.avif', 'machine_box', 'machine_groups_models_2', '70 capsules comme cadeau', 'bag_group_7', '990,00 RON', '[]'),
('espressor-essenza-mini-piano-noir-c30', 'original', 'Espressors', 'Machine à espresso Essenza Mini Piano Noir C30', 590, 10, 'Le plus petite Machine à espresso FILSPRESSO.', '[]', 'images/Machines/Original/Espresso Machines/Essenza Mini Piano noir.avif', 'machine_box', 'machine_groups_models_2', '50 capsules comme cadeau', 'bag_group_8', '590,00 RON', '[]'),
('espresso machine-pixie-carmine', 'original', 'Espressors', 'Machine à espresso Pixie Carmine', 632, 10, 'Le Design est industriel and ergonomique.', '[]', 'images/Machines/Original/Espresso Machines/Pixie Carmina.avif', 'machine_box', 'machine_groups_models_2', '50 capsules comme cadeau', 'bag_group_7', '632,00 RON', '[]'),
('espressor-citiz-lait-c123-cerise-rouge', 'original', 'Machines à espresso avec du lait', 'Machine à espresso CitiZ&Lait C123 Cerise Rouge', 1032, 10, 'Aeroccino intégré, pour des recettes spectaculaires with du lait', '[]', 'images/Machines/Original/Espresso Machines Latte/CitiZ&Milk C123 Visiniu.avif', 'machine_box', 'machine_groups_models_2', '70 capsules comme cadeau', 'bag_group_9', '1032,00 RON', '[]'),
('machine-espresso-gran-lattissima-noir-l-gant', 'original', 'Machines à espresso avec du lait', 'Machine à espresso Gran Lattissima noir élégant', 1512, 10, 'Des recettes de café au lait sur simple pression d''un bouton.', '[]', 'images/Machines/Original/Espresso Machines Latte/Gran Lattissima Negru Elegant.avif', 'machine_box', 'machine_groups_models_2', '100 capsules comme cadeau', 'bag_group_8', '1512,00 RON', '[]'),
('machine-espresso-lattissima-one-evolution-noir', 'original', 'Machines à espresso avec du lait', 'Machine à espresso Lattissima One Evolution Noir', 1390, 10, 'Des recettes spectaculaires de café au lait sur simple pression d''un bouton.', '[]', 'images/Machines/Original/Espresso Machines Latte/Lattissima One Evolution Negru.avif', 'machine_box', 'machine_groups_models_2', '70 capsules comme cadeau', 'bag_group_10', '1390,00 RON', '[]'),
('pack-vertuo-pop-aqua-mint-caf-et-porte-capsules', 'vertuo', 'Forfaits spéciaux', 'Forfait Vertuo Pop Aqua Mint, café and porte-capsules', 958, 10, 'Le paquet contient:', '["-1x Machine à espresso Vertuo POP;","-50x capsules de café Vertuo;","-1x Suport capsules Mia Lume."]', 'images/Machines/Vertuo/Special Packs/Vertuo-POP-AquaMint-50caps.avif', 'machine_box_2', 'machine_groups_models', '50 capsules', 'bag_group', '958,00 RON', '[]'),
('pack-vertuo-pop-spicy-red-caf-porte-capsule-et-aeroccino', 'vertuo', 'Forfaits spéciaux', 'Forfait Vertuo Pop Spicy Red, café, porte-capsule and Aeroccino', 1041.75, 10, 'Le paquet contient:', '["-1x Machine à espresso Vertuo POP;","-50x capsules de café Vertuo;","-1x Aeroccino 3;","-1x Suport capsules Mia Lume."]', 'images/Machines/Vertuo/Special Packs/Vertuo-POP-SpicyRed-50caps.avif', 'machine_box_2', 'machine_groups_models', '50 capsules', 'bag_group_4', '1041,75 RON', '[]'),
('forfait-vertuo-pop-mango-yellow-caf-porte-capsule-et-aeroccino', 'vertuo', 'Forfaits spéciaux', 'Forfait Vertuo Pop Mango Yellow, café, porte-capsule and Aeroccino', 1389, 10, 'Le paquet contient:', '["-1x Machine à espresso Vertuo POP;","-70x capsules de café Vertuo;","-1x Aeroccino 3;","-1x Suport capsules Mia Lume."]', 'images/Machines/Vertuo/Special Packs/Vertuo-POP-YellowMango-70caps.avif', 'machine_box_2', 'machine_groups_models', '70 capsules', 'bag_group_4', '1389,00 RON', '[]'),
('machine-espresso-vertuo-next-c-rouge-cerise', 'vertuo', 'Machines à espresso', 'Machine à espresso Vertuo Next C Rouge Cerise', 592.5, 10, 'Une machine à espresso, 5 tailles de café différentes.', '[]', 'images/Machines/Vertuo/Espresso Machines/Next C Cherry Rosu.webp', 'machine_box_2', 'machine_groups_models_2', '50 capsules comme cadeau', 'bag_group_11', '592,50 RON', '[]'),
('machine-espresso-vertuo-pop-deluxe-titan', 'vertuo', 'Machines à espresso', 'Machine à espresso Vertuo Pop+ Deluxe Titan', 790, 10, 'Transformez chaque jour en une expérience élégante.', '[]', 'images/Machines/Vertuo/Espresso Machines/vertuo pop+ Deluxe Titan.avif', 'machine_box', 'machine_groups_models_2', '50 capsules comme cadeau', 'bag_group_8', '790,00 RON', '[]'),
('machine-espresso-vertuo-plus-d-rouge', 'vertuo', 'Machines à espresso', 'Machine à espresso Vertuo Plus D rouge', 1090, 10, 'Design with accents chromés and réservoir d''eau mobile.', '[]', 'images/Machines/Vertuo/Espresso Machines/vertuo-plus-d-rosu.avif', 'machine_box_2', 'machine_groups_models_2', '50 capsules comme cadeau', 'bag_group_8', '1090,00 RON', '[]'),
('espresso-vertuo-next-c-rouge-aeroccino-3-rouge', 'vertuo', 'Machines à espresso avec du lait', 'Espresso Vertuo Next C Rouge & Aeroccino 3 Rouge', 892.5, 10, 'Cinq tailles de café and recettes de café différentes', '[]', 'images/Machines/Vertuo/Espresso Machines Latte/Next-Red-Aeroccino-Red.avif', 'machine_box', 'machine_groups_models_2', '50 capsules comme cadeau', 'bag_group_11', '892,50 RON', '[]'),
('vertuo-pop-aqua-mint-aeroccino-3-noir-espresso', 'vertuo', 'Machines à espresso avec du lait', 'Vertuo Pop Aqua Mint & Aeroccino 3 Noir Espresso', 1029, 10, 'Couche généreuse de crème épaisse and recettes de lait parfaites.', '[]', 'images/Machines/Vertuo/Espresso Machines Latte/Vertuo Pop Aqua mini & Aeroccino 3 Noir.avif', 'machine_box', 'machine_groups_models_2', '50 capsules comme cadeau', 'bag_group_9', '1029,00 RON', '[]'),
('machine-espresso-vertuo-lattissima-blanc', 'vertuo', 'Machines à espresso with du lait', 'Machine à espresso Vertuo Lattissima Blanc', 1990, 10, 'Recettes préférées de café au lait, préparées facilement.', '[]', 'images/Machines/Vertuo/Espresso Machines Latte/VertuoLattissima alb.avif', 'machine_box_2', 'machine_groups_models_2', '50 capsules comme cadeau', 'bag_group_8', '1990,00 RON', '[]');
