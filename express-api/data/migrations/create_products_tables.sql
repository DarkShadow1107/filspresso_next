-- =============================================
-- FILSPRESSO PRODUCTS STOCK MANAGEMENT
-- Migration: Create coffee and machine products tables
-- =============================================

-- Drop tables if they exist (for clean migration)
DROP TABLE IF EXISTS machine_products;
DROP TABLE IF EXISTS coffee_products;

-- =============================================
-- COFFEE PRODUCTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS coffee_products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(100) NOT NULL UNIQUE,
    product_type ENUM('original', 'vertuo') NOT NULL,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    stock INT NOT NULL DEFAULT 100,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_product_id (product_id),
    INDEX idx_product_type (product_type),
    INDEX idx_stock (stock)
);

-- =============================================
-- MACHINE PRODUCTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS machine_products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(150) NOT NULL UNIQUE,
    product_type ENUM('original', 'vertuo') NOT NULL,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    stock INT NOT NULL DEFAULT 10,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_product_id (product_id),
    INDEX idx_product_type (product_type),
    INDEX idx_stock (stock)
);

-- =============================================
-- INSERT ALL COFFEE PRODUCTS FROM JSON
-- =============================================

-- Original Coffees - Édition Limitée
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('dharkan', 'original', 'Dharkan', 55.00, 100),
('espresso-noir-festif', 'original', 'Espresso noir festif', 47.50, 100),
('-pices-d-lices-de-saison', 'original', 'Épices délices de saison', 47.50, 100),
('no20', 'original', 'No20', 135.00, 100),
('galapagos', 'original', 'Galapagos', 80.00, 100),
('hawaii-kona', 'original', 'Hawaii Kona', 80.00, 100),
('almond-croissant-flavor', 'original', 'Almond Croissant Flavor', 67.50, 100),
('peanut-and-roasted-sesame-flavour', 'original', 'Peanut and Roasted Sesame Flavour', 67.50, 100),
('unforgettable-espresso', 'original', 'Unforgettable Espresso', 67.50, 100);

-- Original Coffees - Espresso
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('capriccio', 'original', 'Capriccio', 24.50, 100),
('cosi', 'original', 'Cosi', 24.50, 100),
('volutto', 'original', 'Volutto', 24.50, 100),
('volutto-decaffeinato', 'original', 'Volutto Decaffeinato', 25.50, 100);

-- Original Coffees - Ispirazione Italiana
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('kazaar', 'original', 'Kazaar', 22.00, 100),
('livanto', 'original', 'Livanto', 22.00, 100),
('ristretto', 'original', 'Ristretto', 22.00, 100),
('inspirazione-napoli', 'original', 'Inspirazione Napoli', 22.00, 100),
('inspirazione-roma', 'original', 'Inspirazione Roma', 22.00, 100),
('inspirazione-venezia', 'original', 'Inspirazione Venezia', 22.00, 100),
('arpeggio', 'original', 'Arpeggio', 22.00, 100);

-- Original Coffees - Italian Explorations
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('ispirazione-palermo', 'original', 'Ispirazione Palermo', 28.50, 100),
('ispirazione-sicilia', 'original', 'Ispirazione Sicilia', 28.50, 100),
('ispirazione-aosta', 'original', 'Ispirazione Aosta', 28.50, 100),
('inspirazione-emilia', 'original', 'Inspirazione Emilia', 28.50, 100),
('decaffeinato', 'original', 'Decaffeinato', 29.50, 100),
('peru-organic', 'original', 'Peru Organic', 32.00, 100);

-- Original Coffees - Créations Barista
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('caramello', 'original', 'Caramello', 25.50, 100),
('chiaro', 'original', 'Chiaro', 24.50, 100),
('cioccolatino', 'original', 'Cioccolatino', 25.50, 100),
('corto', 'original', 'Corto', 24.50, 100),
('nocciola', 'original', 'Nocciola', 25.50, 100),
('scuro', 'original', 'Scuro', 24.50, 100),
('vanille', 'original', 'Vanille', 25.50, 100);

-- Original Coffees - Explorations du Monde
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('buenos-aires-lungo', 'original', 'Buenos Aires Lungo', 24.50, 100),
('cape-town-lungo', 'original', 'Cape Town Lungo', 24.50, 100),
('istanbul-espresso', 'original', 'Istanbul Espresso', 23.00, 100),
('paris-espresso', 'original', 'Paris Espresso', 23.00, 100),
('rio-de-janeiro-espresso', 'original', 'Rio de Janeiro Espresso', 23.00, 100),
('shanghai-lungo', 'original', 'Shanghai Lungo', 24.50, 100),
('stockholm-lungo', 'original', 'Stockholm Lungo', 24.50, 100),
('tokyo-lungo', 'original', 'Tokyo Lungo', 24.50, 100),
('vienna-lungo', 'original', 'Vienna Lungo', 24.50, 100);

-- Original Coffees - Origines Principales
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('kahawa-ya-congo-organic', 'original', 'Kahawa ya Congo Organic', 42.50, 100),
('zambia', 'original', 'Zambia', 34.50, 100),
('colombia', 'original', 'Colombia', 24.90, 100),
('ethiopia', 'original', 'Ethiopia', 24.90, 100),
('india', 'original', 'India', 24.90, 100),
('indonesia', 'original', 'Indonesia', 24.90, 100),
('nicaragua', 'original', 'Nicaragua', 24.90, 100);

-- Vertuo Coffees - Édition Limitée
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('white-chocolate-and-strawberry', 'vertuo', 'White Chocolate and Strawberry', 88.50, 100),
('peanut-and-roasted-sesame-flavour-vertuo', 'vertuo', 'Peanut and Roasted Sesame Flavour', 74.90, 100),
('almond-croissant-flavour-vertuo', 'vertuo', 'Almond Croissant Flavour', 74.90, 100),
('unforgettable-double-espresso', 'vertuo', 'Unforgettable Double Espresso', 74.90, 100),
('no20-vertuo', 'vertuo', 'No20', 155.00, 100),
('hawaii-kona-vertuo', 'vertuo', 'Hawaii Kona', 110.00, 100);

-- Vertuo Coffees - Coffee+
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('ginseng-delight', 'vertuo', 'Ginseng Delight', 45.00, 100),
('melozio-go', 'vertuo', 'Melozio Go', 49.50, 100),
('stormio-go', 'vertuo', 'Stormio Go', 49.50, 100),
('vivida', 'vertuo', 'Vivida', 49.50, 100);

-- Vertuo Coffees - Créations Barista
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('bianco-doppio', 'vertuo', 'Bianco Doppio', 29.00, 100),
('bianco-forte', 'vertuo', 'Bianco Forte', 33.90, 100),
('bianco-piccolo', 'vertuo', 'Bianco Piccolo', 27.50, 100),
('caramel-dor-', 'vertuo', 'Caramel doré', 36.50, 100),
('chocolat-riche', 'vertuo', 'Chocolat riche', 36.50, 100),
('noisettes-grill-es', 'vertuo', 'Noisettes grillées', 36.50, 100),
('vanille-douce', 'vertuo', 'Vanille Douce', 36.50, 100),
('vanille-douce-decaffeinato', 'vertuo', 'Vanille Douce Decaffeinato', 38.00, 100);

-- Vertuo Coffees - Espressos
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('altissio', 'vertuo', 'Altissio', 25.50, 100),
('diavolitto', 'vertuo', 'Diavolitto', 25.50, 100),
('il-caff-', 'vertuo', 'Il caffè', 25.50, 100),
('orafio', 'vertuo', 'Orafio', 27.50, 100),
('ristretto-classico', 'vertuo', 'Ristretto Classico', 25.50, 100),
('ristretto-intenso', 'vertuo', 'Ristretto Intenso', 25.50, 100),
('toccanto', 'vertuo', 'Toccanto', 25.50, 100),
('voltesso', 'vertuo', 'Voltesso', 25.50, 100);

-- Vertuo Coffees - Double Espresso
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('double-espresso-scuro', 'vertuo', 'Double Espresso Scuro', 35.00, 100),
('double-espresso-dolce', 'vertuo', 'Double Espresso Dolce', 35.00, 100),
('double-espresso-chiaro', 'vertuo', 'Double Espresso Chiaro', 35.00, 100),
('double-espresso-chiaro-decaffeinato', 'vertuo', 'Double Espresso Chiaro Decaffeinato', 37.00, 100);

-- Vertuo Coffees - Gran Lungo
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('inizio', 'vertuo', 'Inizio', 37.50, 100),
('arondio', 'vertuo', 'Arondio', 37.50, 100),
('fortado', 'vertuo', 'Fortado', 37.50, 100),
('fortado-decaffeinato', 'vertuo', 'Fortado Decaffeinato', 39.00, 100);

-- Vertuo Coffees - Tasse (Mug)
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('half-caffeinato', 'vertuo', 'Half Caffeinato', 33.00, 100),
('intenso', 'vertuo', 'Intenso', 36.50, 100),
('melozio', 'vertuo', 'Melozio', 33.00, 100),
('odacio', 'vertuo', 'Odacio', 33.00, 100),
('solelio', 'vertuo', 'Solelio', 36.50, 100),
('stormio', 'vertuo', 'Stormio', 33.00, 100);

-- Vertuo Coffees - Origines Principales
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('colombia-vertuo', 'vertuo', 'Colombia', 36.50, 100),
('costa-rica', 'vertuo', 'Costa Rica', 34.50, 100),
('el-salvador', 'vertuo', 'El Salvador', 36.50, 100),
('ethiopia-vertuo', 'vertuo', 'Ethiopia', 34.50, 100),
('mexico', 'vertuo', 'Mexico', 36.50, 100),
('peru-organic-vertuo', 'vertuo', 'Peru Organic', 39.50, 100),
('kahawa-ya-congo-organic-vertuo', 'vertuo', 'Kahawa ya Congo Organic', 52.50, 100),
('zambia-vertuo', 'vertuo', 'Zambia', 47.50, 100);

-- Vertuo Coffees - Craft Brew
INSERT INTO coffee_products (product_id, product_type, name, price, stock) VALUES
('alto-onice', 'vertuo', 'Alto Onice', 54.70, 100),
('cold-brew-style-intense', 'vertuo', 'Cold-Brew Style Intense', 71.90, 100),
('carafe-pour-over-style-intense', 'vertuo', 'Carafe Pour-Over Style Intense', 63.70, 100);

-- =============================================
-- INSERT ALL MACHINE PRODUCTS FROM JSON
-- =============================================

-- Original Machines - Forfaits spéciaux
INSERT INTO machine_products (product_id, product_type, name, price, stock) VALUES
('pack-essenza-mini-c30-blanc-caf-porte-capsule', 'original', 'Forfait Essenza Mini C30 Blanc, café & porte capsule', 841.40, 10),
('pack-essenza-mini-d30-rouge-caf-porte-capsule', 'original', 'Forfait Essenza Mini D30 Rouge, café & porte capsule', 631.05, 10),
('forfait-inissia-black-caf-aeroccino3-porte-capsule', 'original', 'Forfait Inissia Black, café & Aeroccino 3 & porte capsule', 877.80, 10);

-- Original Machines - Espressors
INSERT INTO machine_products (product_id, product_type, name, price, stock) VALUES
('espressor-citiz-d113-noir', 'original', 'Machine à espresso CitiZ D113 Noir', 990.00, 10),
('espressor-essenza-mini-piano-noir-c30', 'original', 'Machine à espresso Essenza Mini Piano Noir C30', 590.00, 10),
('espresso machine-pixie-carmine', 'original', 'Machine à espresso Pixie Carmine', 632.00, 10);

-- Original Machines - Machines à espresso avec du lait
INSERT INTO machine_products (product_id, product_type, name, price, stock) VALUES
('espressor-citiz-lait-c123-cerise-rouge', 'original', 'Machine à espresso CitiZ&Lait C123 Cerise Rouge', 1032.00, 10),
('machine-espresso-gran-lattissima-noir-l-gant', 'original', 'Machine à espresso Gran Lattissima noir élégant', 1512.00, 10),
('machine-espresso-lattissima-one-evolution-noir', 'original', 'Machine à espresso Lattissima One Evolution Noir', 1390.00, 10);

-- Vertuo Machines - Forfaits spéciaux
INSERT INTO machine_products (product_id, product_type, name, price, stock) VALUES
('pack-vertuo-pop-aqua-mint-caf-et-porte-capsules', 'vertuo', 'Forfait Vertuo Pop Aqua Mint, café et porte-capsules', 958.00, 10),
('pack-vertuo-pop-spicy-red-caf-porte-capsule-et-aeroccino', 'vertuo', 'Forfait Vertuo Pop Spicy Red, café, porte-capsule et Aeroccino', 1041.75, 10),
('forfait-vertuo-pop-mango-yellow-caf-porte-capsule-et-aeroccino', 'vertuo', 'Forfait Vertuo Pop Mango Yellow, café, porte-capsule et Aeroccino', 1389.00, 10);

-- Vertuo Machines - Machines à espresso
INSERT INTO machine_products (product_id, product_type, name, price, stock) VALUES
('machine-espresso-vertuo-next-c-rouge-cerise', 'vertuo', 'Machine à espresso Vertuo Next C Rouge Cerise', 592.50, 10),
('machine-espresso-vertuo-pop-deluxe-titan', 'vertuo', 'Machine à espresso Vertuo Pop+ Deluxe Titan', 790.00, 10),
('machine-espresso-vertuo-plus-d-rouge', 'vertuo', 'Machine à espresso Vertuo Plus D rouge', 1090.00, 10);

-- Vertuo Machines - Machines à espresso avec du lait
INSERT INTO machine_products (product_id, product_type, name, price, stock) VALUES
('espresso-vertuo-next-c-rouge-aeroccino-3-rouge', 'vertuo', 'Espresso Vertuo Next C Rouge & Aeroccino 3 Rouge', 892.50, 10),
('vertuo-pop-aqua-mint-aeroccino-3-noir-espresso', 'vertuo', 'Vertuo Pop Aqua Mint & Aeroccino 3 Noir Espresso', 1029.00, 10),
('machine-espresso-vertuo-lattissima-blanc', 'vertuo', 'Machine à espresso Vertuo Lattissima Blanc', 1990.00, 10);

-- =============================================
-- SUMMARY
-- =============================================
-- Total Coffee Products: 97
-- - Original: 56 products
-- - Vertuo: 41 products
-- 
-- Total Machine Products: 15
-- - Original: 9 products
-- - Vertuo: 6 products
-- =============================================
