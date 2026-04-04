"""
Seed the PostgreSQL coffee_facts table with embeddings from Tanka (Semantic mode).
Run this once to populate the vector database.
"""

import psycopg2
import os
from dotenv import load_dotenv
from pathlib import Path
from models.tanka import TankaModel

env_path = Path(__file__).parent / ".env"
if not env_path.exists():
    env_path = Path(__file__).parent / ".env.local"
load_dotenv(dotenv_path=env_path)

DB_CONFIG = {
    "dbname": os.getenv("DB_NAME", "filspresso"),
    "user": os.getenv("DB_USER", "filspresso_user"),
    "password": os.getenv("DB_PASSWORD"),
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
}

COFFEE_FACTS = [
    # ── Roasts ──────────────────────────────────────────────────────────────
    "Light roast coffee has a light brown color and no oil on the surface of the beans. It has the highest acidity and preserves the most original flavor of the bean.",
    "Medium roast coffee is medium brown in color with a bit more body than a light roast. It has a balanced flavor, aroma, and acidity.",
    "Dark roast coffee is dark brown, sometimes almost black, with a shiny, oily surface. It has a low acidity and a heavy body with smoky or bitter notes.",
    "The roasting process transforms green coffee beans into the aromatic brown beans we know through the Maillard reaction.",
    "Espresso is typically made with a dark roast to provide a strong, bold flavor that can cut through milk in lattes and cappuccinos.",
    "City roast is a medium-light roast style popular in Scandinavian countries, prized for preserving the brightness of origin-forward single-origin coffees.",
    "Vienna roast is a medium-dark roast where both the Maillard and caramelisation reactions are complete, giving a smooth, bittersweet chocolate character.",
    "Italian roast is the darkest commercial roast — nearly black beans with a strong smoky bitterness and very low acidity, traditional in Southern Italy.",

    # ── Bean varieties & origins ─────────────────────────────────────────────
    "Arabica beans are generally considered higher quality and have a sweeter, softer taste with tones of sugar, fruit, and berries.",
    "Robusta beans have a stronger, harsher taste with twice as much caffeine as Arabica. They are often used in espresso blends for better crema.",
    "Coffee roasting involves heating the beans to temperatures between 370 and 540 degrees Fahrenheit (188 to 282 degrees Celsius).",
    "The 'first crack' in roasting occurs around 385°F (196°C) when the beans expand and moisture evaporates, sounding like popcorn popping.",
    "The 'second crack' occurs around 435°F (224°C), indicating a darker roast as the bean's internal structure begins to break down and oils migrate to the surface.",
    "Ethiopian coffee is known for its bright acidity and fruity, floral, and wine-like flavor notes — often blueberry or jasmine.",
    "Colombian coffee is medium-bodied with a smooth, mild flavor featuring caramel sweetness and a slight nuttiness.",
    "Brazilian coffee tends to be low-acidity, full-bodied, and chocolatey — perfect as an espresso base.",
    "Guatemalan coffee from Antigua grows at high altitude under volcanic influence, producing a full body, bright acidity, and smoky chocolate notes.",
    "Kenyan coffee is bold and winey with black-currant, tomato, and citrus zest characteristics — one of the most distinctive African origins.",
    "Costa Rican coffee is clean, balanced, and mild with honey-like sweetness and light citrus acidity from high-altitude volcanic soils.",
    "Yemen Mocha coffee is one of the oldest cultivated coffees in the world, with wild, fruity, and spicy complexity — the origin of the mocha name.",
    "Indonesian coffees (Sumatra, Java, Sulawesi) are typically earthy, full-bodied, low-acid, and complex with herbal and dark-chocolate notes.",
    "Nicaraguan coffee offers a mild body, bright acidity, and clean sweetness — often described as having caramel, nut, and citrus notes.",
    "Peru Organic coffee is mild, smooth, and subtly sweet with walnut, caramel, and a delicate floral finish.",
    "Zambian coffee from the Muchinga Mountains is characterised by a bright and fruity acidity with peach, plum, and grapefruit notes.",
    "Congo (Kahawa ya Congo Organic) coffee is a smooth, chocolatey coffee grown by cooperatives in the Congo — sweet with cocoa and subtle fruity hints.",
    "Hawaii Kona coffee is one of the world's most sought-after single-origins: light-medium bodied, clean, and bright with honeysuckle and macadamia notes.",
    "Galapagos coffee, grown in volcanic soil with natural shade, is exceptionally clean and smooth with caramel sweetness and a long finish.",

    # ── Processing methods ───────────────────────────────────────────────────
    "Washed (wet) processing removes the fruit before drying, producing a clean, bright, and nuanced cup that highlights origin terroir.",
    "Natural (dry) processing dries the whole coffee cherry under the sun, imparting intense fruity and wine-like sweetness to the cup.",
    "Honey process is a hybrid method where some fruit mucilage is left on the bean during drying, creating a balanced sweetness between washed and natural.",
    "Anaerobic fermentation is an experimental processing method where coffee ferments in sealed, oxygen-free tanks, amplifying exotic fruit and wine notes.",

    # ── Brewing methods ──────────────────────────────────────────────────────
    "Espresso is brewed by forcing hot water at high pressure through finely-ground coffee. A standard shot is 30ml extracted in about 25–30 seconds.",
    "A lungo is a long espresso shot made with more water, creating a milder but larger volume coffee — typically 80–110ml.",
    "A ristretto is a short, concentrated espresso shot using the same grounds but half the water, resulting in a sweeter, more intense cup.",
    "Americano is made by diluting an espresso shot with hot water to approximate the strength of filter coffee while keeping the espresso flavor.",
    "A latte is made with one or two espresso shots topped with steamed milk and a small layer of foam, typically in a 1:3–1:4 espresso-to-milk ratio.",
    "A cappuccino has equal parts espresso, steamed milk, and milk foam — typically 60ml each — creating a rich and airy drink.",
    "A flat white is similar to a latte but smaller and denser, using a double ristretto and microfoam milk for a stronger coffee flavour.",
    "Cold brew coffee is made by steeping ground coffee in cold water for 12–24 hours, producing a smooth, low-acid concentrate.",
    "Pour-over (V60) brewing uses gravity and a paper filter, producing a clean, bright cup that highlights a coffee's origin characteristics.",
    "French press brewing steeps coarsely ground coffee in hot water for 4 minutes before pressing a metal mesh plunger to separate the grounds.",
    "Moka pot brews strong espresso-style coffee on the stovetop by passing steam pressure through ground coffee into the upper chamber.",
    "AeroPress is a versatile hand-brew device that uses air pressure to push water through grounds in 1–2 minutes, yielding a smooth, espresso-like result.",
    "Siphon (vacuum pot) brewing uses vapour pressure and vacuum to brew coffee dramatically — producing a very clean, tea-like cup with complex aromas.",
    "Turkish coffee is prepared by simmering very finely ground coffee in a copper cezve pot with water (and sometimes sugar), creating a thick, unfiltered brew.",
    "Cold brew concentrate is typically brewed at 1:4 ratio grounds-to-water and diluted 1:1 before serving — about twice the strength of regular hot coffee.",
    "A macchiato is an espresso 'stained' with a small dollop of frothy milk — either latte macchiato (milk stained with espresso) or espresso macchiato.",
    "A cortado is equal parts espresso and warm steamed milk (1:1), served in a small glass — popular in Spain and Latin America.",
    "Nitro cold brew is cold brew infused with nitrogen gas, served from a tap to create a creamy, Guinness-like texture with no ice needed.",

    # ── Nespresso capsule system ──────────────────────────────────────────────
    "Nespresso Original capsules are compatible with Essenza, Pixie, Citiz, Inissia, and Expert machines, producing espresso and lungo sizes.",
    "Nespresso Vertuo capsules use Centrifusion technology — spinning the capsule at up to 7000 rpm — to brew espresso, double espresso, gran lungo, mug, and alto sizes.",
    "Nespresso intensity scale ranges from 1 to 13. Intensity measures the concentration of roast and bitterness, not caffeine content.",
    "Intensity 1–4 capsules like Volluto and Vivalto Lungo are mild, sweet, and suited to lungo brewing with light roast profiles.",
    "Intensity 8–10 capsules like Arpeggio and Roma are full-bodied espresso blends with roasted cereal and chocolatey notes.",
    "Intensity 11–13 capsules like Kazaar (12) and Ristretto (10) deliver the most intense, bold, and concentrated espresso experience.",
    "Ispirazione Italiana capsules recreate classic Italian regional espresso styles — Napoli (13), Roma (8), Venezia (8), Palermo (12), Sicilia (10), Aosta (7), and Emilia (7).",
    "Nespresso Master Origin capsules celebrate single-origin coffees — India, Ethiopia, Colombia, Indonesia, Nicaragua, Peru, Zambia, and Kahawa ya Congo — each with unique terroir flavors.",
    "Nespresso Barista Creations capsules (Chiaro, Scuro, Corto, Nocciola, Caramello, Vanille, Cioccolatino) are designed specifically to pair with milk-based drinks.",
    "Nespresso limited edition capsules are seasonal releases that explore special origins and processing methods, available for a limited time.",
    "Nespresso World Explorations capsules offer bold blends inspired by global coffee cultures — Buenos Aires Lungo, Cape Town Lungo, Istanbul Espresso, Paris Espresso, Rio de Janeiro Espresso, Shanghai Lungo, Stockholm Lungo, Tokyo Lungo, and Vienna Lungo.",
    "Nespresso Vertuo offers five cup sizes: Espresso (40ml), Double Espresso (80ml), Gran Lungo (150ml), Mug (230ml), and Alto (414ml).",
    "The Nespresso Original system uses 19 bars of pressure to extract espresso, producing a thick crema and intense flavour from pre-dosed aluminium capsules.",

    # ── Original Line capsule profiles ──────────────────────────────────────
    "Kazaar (intensity 12) is an exceptionally intense espresso with a syrupy body and notes of pepper, wood, and bitterness from Robusta and Arabica blends.",
    "Arpeggio (intensity 9) is a full-bodied espresso with a strong roasted character and cocoa notes — one of Nespresso's most popular Original capsules.",
    "Volluto / Volutto (intensity 4) is a sweet, smooth Original espresso with biscuit and fruit notes — ideal for those who prefer a mild, rounded cup.",
    "Vivalto Lungo (intensity 4) is a complex lungo of South American and East African Arabicas with floral and cereal notes.",
    "Ispirazione Napoli (intensity 13) is a dark roast with intense, creamy body inspired by the espresso tradition of Naples — sweet bitterness and cocoa.",
    "Ethiopia Master Origin (intensity 4) delivers a powerful floral and fruity espresso with jasmine aroma and blueberry notes from Ethiopian washed Arabica.",
    "India Master Origin (intensity 11) is a woody, bold capsule made from Indian washed Robusta with pepper and leather notes.",
    "Cocoa Truffle is a Barista Creation lungo with rich dark chocolate and truffle notes, designed to complement milk for a mocha-style drink.",
    "Vanilla Custard Pie is a Barista Creation with sweet vanilla and pastry notes optimised for mixing with steamed milk.",
    "Dharkan (intensity 11) is a long-roasted espresso with a bitter, woody character and intense Oriental spice notes — one of the boldest in the Original range.",
    "Ristretto (intensity 10) is a short, intense espresso blend of South American and East African Arabicas with a lasting, opulent finish and floral notes.",
    "Livanto (intensity 6) is a rounded, balanced espresso with golden caramel flavour and a subtle toasted character — approachable and consistent.",
    "Cosi (intensity 4) is a delicate, light-roasted lungo with lemon zest and cereal notes — one of the most delicate capsules in the Original range.",
    "Capriccio (intensity 5) is a mild espresso with cereal and light roasted grain notes, smooth enough for an afternoon coffee.",
    "Decaffeinato (intensity 6) is the classic Nespresso Original decaffeinated espresso with a smooth, balanced profile and aromatic persistence.",
    "Volutto Decaffeinato (intensity 4) is a sweet, mild decaffeinated espresso with biscuit and light fruity notes.",
    "Peru Organic (intensity 6) is a certified-organic Original capsule with smooth sweetness, a light body, and hints of walnut and caramel.",
    "Ispirazione Roma (intensity 8) captures the traditional Roman espresso style — mild and balanced with a warm, roasted grain character.",
    "Ispirazione Venezia (intensity 8) renders the Venetian espresso style with a rounded body and subtle cocoa-bitter notes.",
    "Ispirazione Palermo (intensity 12) is an intense, full-bodied blend inspired by the dark, robust espresso culture of Palermo.",
    "Ispirazione Sicilia (intensity 10) offers a complex Italian espresso with a persistent, roasted bitterness and woody notes — inspired by Sicilian tradition.",
    "Ispirazione Aosta (intensity 7) brings a well-rounded and slightly smoky espresso profile inspired by the mountain coffeehouses of Aosta Valley.",
    "Ispirazione Emilia (intensity 7) is an aromatic, balanced espresso with a smooth body and gentle sweetness inspired by the Emilia-Romagna region.",
    "Colombia Master Origin (intensity 6) offers a fruity, medium-bodied espresso with red-fruit acidity and caramel sweetness from Colombian washed Arabica.",
    "Indonesia Master Origin (intensity 7) is an earthy, woody Original espresso — bold and intense with a winey fruitiness from wet-hulled Sumatra Arabica.",
    "Nicaragua Master Origin (intensity 6) is a clean and balanced espresso with light acidity and almond, caramel, and floral cereal notes.",
    "Kahawa ya Congo Organic (intensity 6) is a clean, slightly sweet Master Origin espresso with cocoa and subtle fruity notes — supporting women coffee farmers in Congo.",
    "Zambia (intensity 6) is a Master Origin limited edition O capsule with vibrant stone fruit and black tea notes from the Muchinga mountains.",

    # ── Barista Creations (milk-based) ───────────────────────────────────────
    "Chiaro (intensity 6) is a Barista Creation lungo with toasted malt and biscuit notes — designed to be topped with milk for a sweet, latte-style drink.",
    "Scuro (intensity 8) is a dark-roasted Barista Creation espresso with roasted cereal and cocoa — designed to cut through milk for a bold latte experience.",
    "Corto (intensity 11) is the most intense Barista Creation — a ristretto blend with bitter cocoa that holds its character even in milk-heavy drinks.",
    "Nocciola (intensity 7) is a Barista Creation with warm hazelnut and roasted notes — perfect in a latte for a nutty café-style drink.",
    "Caramello (intensity 6) is a Barista Creation with caramel sweetness and a smooth, silky texture — ideal for caramel latte lovers.",
    "Vanille (intensity 6) is a Barista Creation with delicate vanilla and a soft, rounded character — designed for vanilla latte drinks.",
    "Cioccolatino (intensity 7) is a chocolate-flavoured Barista Creation espresso with dark cocoa notes — delicious as a hot chocolate-style latte.",

    # ── World Explorations capsules ──────────────────────────────────────────
    "Buenos Aires Lungo (intensity 4) is a silky, golden-bodied lungo inspired by the coffee culture of Argentina — smooth with malt and wheat notes.",
    "Cape Town Lungo (intensity 6) is a fruity, berry-forward lungo celebrating the vibrant café culture of South Africa.",
    "Istanbul Espresso (intensity 9) blends dark roasted coffees to evoke the spiced, intense espresso of Turkish coffee houses.",
    "Paris Espresso (intensity 8) pairs Arabica from Latin America and Africa for a sweet, delicate espresso with caramel notes — the Parisian café style.",
    "Rio de Janeiro Espresso (intensity 9) is bold, full-bodied, and slightly chocolatey — inspired by the strong espresso culture of Brazil.",
    "Shanghai Lungo (intensity 6) is smooth and subtle with a delicate floral finish, celebrating China's growing specialty coffee scene.",
    "Stockholm Lungo (intensity 8) uses lightly roasted beans with berry acidity and grain sweetness — inspired by Scandinavian 'filter-style' coffee culture.",
    "Tokyo Lungo (intensity 6) is clean, precise, and balanced with subtle cereal and citrus notes — in homage to Japan's meticulous coffee craftsmanship.",
    "Vienna Lungo (intensity 6) is creamy and smooth with a velvety body and biscuit notes — reflecting the famous Viennese café house tradition.",

    # ── Vertuo capsules — Espresso & Double Espresso ─────────────────────────
    "Vertuo Altissio (intensity 9) is a Vertuo espresso with a thick crema and persistent roasted cereal and bitter cocoa flavour.",
    "Vertuo Diavolitto (intensity 11) is Nespresso's most intense Vertuo espresso — a ristretto-size capsule with a powerful, full-bodied roasted character.",
    "Vertuo Ristretto Classico (intensity 8) is a classic, short Vertuo espresso with a balanced, roasted, and slightly chocolatey profile.",
    "Vertuo Ristretto Intenso (intensity 9) delivers an extra-bold, rich Vertuo ristretto with a deep roasted character and dry cocoa aftertaste.",
    "Vertuo Toccanto (intensity 8) is a full-flavoured double espresso Vertuo capsule with a smooth, rounded, and sweet roasted character.",
    "Vertuo Voltesso (intensity 4) is a sweet, mild Vertuo espresso with a rounded body and hints of biscuit and caramel — Vertuo's gentlest espresso.",
    "Vertuo Orafio (intensity 6) is a balanced Vertuo espresso with golden caramel notes and a smooth, medium-bodied finish.",
    "Vertuo Il Caffè (intensity 7) is a double espresso Vertuo capsule with a balanced body and biscuity, roasted aroma.",
    "Vertuo Double Espresso Scuro (intensity 8) is a bold, dark-roasted double espresso with woody and roasted notes.",
    "Vertuo Double Espresso Dolce (intensity 6) is a smooth, sweet double espresso with a honeyed and caramel character.",
    "Vertuo Double Espresso Chiaro (intensity 6) is a light-roasted double espresso with toasted malt sweetness — the mildest in the double espresso range.",
    "Vertuo Double Espresso Chiaro Decaffeinato (intensity 6) offers the same light, toasty double espresso profile while being 99.9% caffeine-free.",

    # ── Vertuo capsules — Gran Lungo & Mug ──────────────────────────────────
    "Vertuo Inizio (intensity 4) is a delicate gran lungo with subtle fruity and floral notes — a gentle entry point into the Vertuo range.",
    "Vertuo Arondio (intensity 6) is a smooth, well-rounded gran lungo with a lightly sweet and biscuity character.",
    "Vertuo Fortado (intensity 8) is a bold gran lungo with a full-bodied, woody, and roasted character — for those who want intensity in a larger cup.",
    "Vertuo Fortado Decaffeinato (intensity 8) delivers the same bold gran lungo profile of Fortado without the caffeine.",
    "Vertuo Intenso (intensity 8) is a mug-size Vertuo coffee with a full, dark roasted character and earthy, woody notes.",
    "Vertuo Melozio (intensity 6) is a smooth, honeyed mug coffee with sweet biscuit and toffee notes — one of the most popular Vertuo coffees.",
    "Vertuo Odacio (intensity 7) is a mug-size coffee with cereal and biscuit notes, ideal for long coffee breaks.",
    "Vertuo Stormio (intensity 8) is a bold, full-bodied mug coffee with woody and bitter notes for intense coffee lovers.",
    "Vertuo Solelio (intensity 4) is a light, bright mug coffee with delicate fruity and cereal notes — ideal for gentle morning coffee.",
    "Vertuo Half Caffeinato (intensity 5) contains approximately 75mg caffeine per cup — exactly half a regular coffee — for those who want moderate stimulation.",

    # ── Vertuo Master Origins ────────────────────────────────────────────────
    "Vertuo Colombia Master Origin (intensity 6) is a rich, fruit-forward mug coffee with a smooth body and hints of red berry and caramel.",
    "Vertuo Costa Rica Master Origin (intensity 5) is a clean, balanced gran lungo with honey-like sweetness and subtle citrus — grown in volcanic Costa Rican highlands.",
    "Vertuo El Salvador Master Origin (intensity 4) is a mild and smooth gran lungo with a delicate caramel sweetness and light nutty finish.",
    "Vertuo Ethiopia Master Origin (intensity 4) is an espresso-size capsule with a bright floral and fruity profile — blueberry and jasmine from Ethiopian Arabica.",
    "Vertuo Mexico Master Origin (intensity 5) is a balanced, mild mug coffee with a clean sweetness and subtle cereal and citrus notes.",
    "Vertuo Peru Organic Master Origin (intensity 5) is a certified-organic mug coffee with a delicate sweetness, soft body, and walnut notes.",
    "Vertuo Kahawa ya Congo Organic (intensity 6) supports women coffee growers in Congo — a smooth, chocolatey and mildly fruity mug coffee.",
    "Vertuo Zambia (intensity 6) is a limited Master Origin alto coffee with vibrant stone fruit, plum, and black tea characteristics.",

    # ── Vertuo Alto & special sizes ──────────────────────────────────────────
    "Vertuo Alto Onice (intensity 9) is a large 414ml Alto-size Vertuo coffee with a bold, roasted character and thick, persistent crema — for the biggest cup lovers.",
    "Vertuo Cold-Brew Style Intense (intensity 6) is a specially designed Vertuo capsule for cold brew — brew over ice for a refreshing, concentrated cold coffee.",
    "Vertuo Carafe Pour-Over Style Intense (intensity 7) is a large-format Vertuo capsule for brewing 200ml+ of smooth, pour-over-style coffee directly into a carafe.",

    # ── Vertuo Coffee+ functional range ─────────────────────────────────────
    "Vertuo Vivida (intensity 4) is a Nespresso Coffee+ capsule infused with Vitamin B12 — a smooth, mild mug coffee enriched for extra energy support.",
    "Vertuo Ginseng Delight is a Nespresso Coffee+ blend infused with ginseng extract — designed to support focus and vitality.",
    "Vertuo Melozio Go and Stormio Go are Nespresso Vertuo On-the-Go capsules in portable cups — designed to be ready to drink anywhere without a machine.",
    "Vertuo Bianco Doppio (intensity 6) is a Barista Creation double espresso designed for milk — smooth roasted notes and a gentle sweetness for latte lovers.",
    "Vertuo Bianco Forte (intensity 7) is a stronger Barista Creation espresso with roasted cereal and cocoa notes — ideal for cutting through latte milk.",
    "Vertuo Bianco Piccolo (intensity 8) is an intense Barista Creation ristretto that keeps its bold character in a piccolo latte or flat white.",
    "Vertuo Caramel doré is a Barista Creation with warm caramel and golden sweetness — designed to complement frothed milk in a caramel latte.",
    "Vertuo Chocolat riche is a Barista Creation with deep, rich dark chocolate notes — best combined with steamed milk for a café mocha-style drink.",
    "Vertuo Noisettes grillées is a Barista Creation with toasted hazelnut aromatics — pairs beautifully with milk for a nutty, café-inspired drink.",
    "Vertuo Vanille Douce is a Barista Creation with soft, creamy vanilla notes — ideal for a classic vanilla latte.",
    "Vertuo Vanille Douce Decaffeinato is the decaffeinated version of Vanille Douce — the same vanilla sweetness without the caffeine.",

    # ── Limited editions ─────────────────────────────────────────────────────
    "Espresso noir festif is a festive limited edition dark espresso with intense roasted notes, released seasonally.",
    "Épices délices de saison is a spiced limited edition capsule with warm, seasonal aromatic notes — available for a short period each year.",
    "No20 is a special edition double espresso Vertuo capsule from the Nespresso Master Crafts collection, celebrating blending expertise.",
    "Almond Croissant Flavor is a flavored Nespresso capsule with sweet almond and buttery pastry notes — inspired by the classic French breakfast.",
    "Peanut and Roasted Sesame Flavour is a bold and unusual flavored capsule combining nutty roasted peanut and sesame — a distinctly Asian-inspired coffee.",
    "White Chocolate and Strawberry is a dessert-inspired flavored Vertuo capsule with sweet white chocolate and berry notes.",
    "Unforgettable Espresso and Unforgettable Double Espresso are premium limited editions crafted from rare, exceptional-quality coffee harvests.",

    # ── Nespresso machines (Original Line) ──────────────────────────────────
    "The Nespresso Essenza Mini is the smallest Original machine — compact, available in two water temperatures, and affordable for home use.",
    "The Nespresso Pixie is a slim Original machine with programmable cup sizes and fast heat-up time of under 25 seconds.",
    "The Nespresso Citiz has a retro design, programmable cup sizes, and optional Aeroccino milk frother — a classic home machine.",
    "The Nespresso Expert connects to a smartphone app and has three temperature settings — ideal for tech-savvy coffee lovers.",
    "The Nespresso Creatista is a collaboration with Breville/Sage offering a built-in steam wand with latte art capability — barista quality at home.",
    "The Nespresso Lattissima Pro has an integrated one-touch milk system and touch display for lattes, cappuccinos, and flat whites.",

    # ── Nespresso machines (Vertuo Line) ────────────────────────────────────
    "The Nespresso Vertuo Pop is the entry-level Vertuo machine — colorful, compact, and WiFi-enabled for cloud connectivity.",
    "The Nespresso Vertuo Next is a compact, WiFi-connected Vertuo machine with five cup sizes and eco-efficient design.",
    "The Nespresso Vertuo Plus has a motorised capsule head for easy one-hand operation and five cup sizes.",
    "The Nespresso Vertuo Creatista is the premium Vertuo machine with a built-in steam wand for microfoam and latte art.",

    # ── Caffeine & science ───────────────────────────────────────────────────
    "A standard Nespresso espresso capsule contains approximately 60–80mg of caffeine depending on the blend.",
    "Lungo capsules yield more caffeine per cup than espresso capsules because more water passes through the grounds, extracting more caffeine over time.",
    "Decaffeinated coffee uses water, CO2, or ethyl acetate processes to remove 97–99.9% of caffeine while preserving most flavor compounds.",
    "Caffeine is a natural stimulant found in coffee beans that blocks adenosine receptors in the brain, temporarily reducing the sensation of tiredness.",
    "Robusta beans contain roughly twice the caffeine of Arabica beans — around 2.7% vs 1.5% by weight.",
    "The optimal water temperature for espresso extraction is 90–96°C — too hot scorches the grounds; too cool under-extracts leading to sourness.",
    "Grind size is one of the most important variables in coffee extraction: finer grind for espresso, coarser for French press and cold brew.",
    "Crema is the golden-brown emulsion of coffee oils that forms on top of a correctly extracted espresso — a sign of freshness and good extraction.",
    "Over-extraction produces bitter, dry, astringent coffee because too many soluble compounds — including undesirable ones — leave the grounds.",
    "Under-extraction produces sour, weak, watery coffee because the extraction was too brief and not enough desirable compounds were dissolved.",
    "Carbon dioxide (CO2) degasses from freshly roasted beans — this is why fresh beans bloom and why very fresh coffee can produce uneven extraction.",

    # ── Milk & coffee drinks ─────────────────────────────────────────────────
    "Microfoam is finely textured steamed milk with tiny uniform bubbles — essential for latte art and a smooth mouthfeel in lattes and flat whites.",
    "Oat milk is the most popular plant-based milk for espresso drinks because it froths well and has a neutral sweetness that complements coffee.",
    "Milk naturally sweetens espresso by releasing lactose sugars when heated to 60–65°C — above 70°C it begins to scorch and loses sweetness.",
    "Almond milk has a light, nutty flavor but froths poorly compared to oat milk — it lacks the protein needed for stable microfoam.",
    "Soy milk is a good dairy alternative for coffee — it has a neutral flavor and proteins that allow it to froth, though it can curdle with acidic coffees.",
    "Coconut milk adds a tropical, naturally sweet flavor to coffee but is harder to froth due to lower protein content.",
    "The Aeroccino is Nespresso's dedicated milk frother — it produces hot or cold froth in under a minute and is compatible with most milk types.",
    "A macchiato contains just a dash of milk — usually 2–5ml of foamed milk on top of an espresso, preserving most of the espresso's intensity.",
    "Spanish latte (café con leche) is made with equal parts strong coffee and hot milk — bolder and less milky than a latte.",
    "Vienna coffee is strong coffee topped with a generous dollop of whipped cream — a classic of Viennese café culture.",
    "Irish coffee is a cocktail of hot filter coffee, Irish whiskey, sugar, and topped with lightly whipped cream.",
    "Affogato is a simple Italian dessert of a scoop of vanilla gelato or ice cream 'drowned' with one or two shots of hot espresso.",

    # ── Health & wellness ────────────────────────────────────────────────────
    "Moderate coffee consumption (3–4 cups per day) is associated with reduced risk of type 2 diabetes, heart disease, and certain neurological conditions.",
    "Antioxidants in coffee — including chlorogenic acid and polyphenols — help protect cells from oxidative stress and inflammation.",
    "Coffee is the single largest dietary source of antioxidants for many people in Western countries.",
    "Consuming caffeine 30–60 minutes before exercise can improve endurance and athletic performance by mobilising fatty acids as fuel.",
    "L-theanine, found in small amounts in some coffee varieties, promotes calm alertness when combined with caffeine.",
    "Decaffeinated coffee still contains antioxidants and most of the health benefits of regular coffee — minus the stimulant effect.",
    "Drinking coffee late in the day can disrupt sleep because caffeine has a half-life of 5–7 hours in the human body.",

    # ── Storage & freshness ──────────────────────────────────────────────────
    "Ground coffee should be stored in an airtight container away from light, heat, and moisture to preserve freshness for up to 2 weeks.",
    "Whole coffee beans stay fresh longer than pre-ground coffee — up to 4 weeks after opening when stored properly.",
    "Nespresso capsules are nitrogen-sealed to preserve freshness and have a shelf life of 6–12 months from manufacturing date.",
    "Coffee beans should never be stored in the refrigerator — condensation introduces moisture that rapidly degrades flavor.",
    "Freezing whole coffee beans in a sealed, airtight bag can extend freshness for up to 6 months — but only freeze once and use immediately after thawing.",
    "Specialty-grade coffee is best consumed within 2–4 weeks after roasting — peak flavor develops in the first 7–14 days of off-gassing.",

    # ── Coffee history & culture ─────────────────────────────────────────────
    "Coffee was first cultivated and traded in Yemen in the 15th century, originating from the Kaffa region of Ethiopia where wild plants still grow.",
    "The first coffeehouses ('qahveh khaneh') opened in the Middle East in the 15th and 16th centuries as centres of social activity and intellectual exchange.",
    "Nespresso was created by Eric Favre, a Nestlé engineer, and patented in 1976 — the Nespresso Original system launched commercially in 1986.",
    "Italy's espresso culture dates to 1901 when Luigi Bezzera invented the first steam-pressure espresso machine — the foundation of modern café culture.",
    "The Specialty Coffee Association (SCA) defines specialty-grade coffee as beans scoring 80 or above on a 100-point quality scale.",
    "Third-wave coffee treats coffee as an artisanal product — like wine — focusing on single origins, transparent sourcing, and precise brewing techniques.",
    "The term 'espresso' comes from Italian and means 'pressed out' — referring to the method of forcing pressurised hot water through compacted grounds.",
    "Brazil produces around 30–40% of the world's total coffee supply, making it the single largest coffee-producing country by volume.",
    "Vietnam is the world's second-largest coffee producer — primarily exporting Robusta beans used in instant coffees and espresso blends.",

    # ── Sustainability ────────────────────────────────────────────────────────
    "Nespresso's AAA Sustainable Quality Program works with farmers in 12 countries to promote sustainable coffee farming practices.",
    "Nespresso aluminium capsules are recyclable through dedicated Nespresso recycling bags and collection points in over 100 countries.",
    "Specialty coffee refers to beans scoring 80+ points on the SCA scale, sourced from specific microclimates for exceptional cup quality.",
    "Shade-grown coffee is cultivated under forest canopy, preserving biodiversity and producing slower-ripening cherries with more complex flavors.",
    "Rainforest Alliance and Fairtrade certifications ensure coffee is grown with environmental care and fair wages for farmers.",
    "Coffee's carbon footprint can be reduced by choosing aluminium-recyclable capsules, reusable filters, and buying locally roasted beans.",

    # ── Food pairings ────────────────────────────────────────────────────────
    "Intense espresso capsules like Kazaar or Dharkan pair excellently with dark chocolate (70%+) — the bitterness of both is complementary.",
    "Mild, sweet capsules like Volluto or Livanto pair well with almond pastries, croissants, and shortbread biscuits.",
    "Fruity, floral capsules like Ethiopia pair beautifully with cheesecake, lemon tart, or fresh berries.",
    "Barista Creation milk capsules like Chiaro or Caramello are designed to be paired with warm milk and enjoyed with cinnamon rolls or carrot cake.",
    "Colombian or Honduran filter-style coffees complement tropical fruit desserts — mango, passionfruit tarts, or coconut-based sweets.",
]


def seed():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
        cur.execute("DROP TABLE IF EXISTS coffee_facts")
        cur.execute("""
            CREATE TABLE coffee_facts (
                id SERIAL PRIMARY KEY,
                fact TEXT NOT NULL,
                embedding vector(384)
            )
        """)

        tanka = TankaModel()
        print("Vectorizing facts using Tanka [Semantic]...")
        for fact in COFFEE_FACTS:
            embedding = tanka.encode(fact)
            cur.execute("INSERT INTO coffee_facts (fact, embedding) VALUES (%s, %s)", (fact, embedding))

        conn.commit()
        cur.close()
        conn.close()
        print(f"Seeding complete: {len(COFFEE_FACTS)} coffee facts stored.")
    except Exception as exc:
        print(f"Seeding failed: {exc}")


if __name__ == "__main__":
    seed()
