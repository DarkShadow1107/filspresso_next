#!/usr/bin/env python3
"""
ChEMBL Data Download Script for Tanka Chemistry Mode
Downloads coffee-related molecular data from ChEMBL database
Focuses on caffeine compounds, antioxidants, and flavor molecules
"""

from chembl_webresource_client.new_client import new_client
import json
import pandas as pd
from pathlib import Path
import sys
from typing import List, Dict, Optional

# Configuration
DATA_DIR = Path(__file__).parent / "data"
OUTPUT_FILE = DATA_DIR / "chembl-training.json"


def search_molecules_by_name(molecule_names: List[str]) -> List[Dict]:
    """
    Search ChEMBL for specific molecules by name
    
    Args:
        molecule_names: List of molecule names to search for
    
    Returns:
        List of molecule data dictionaries
    """
    print(f"Searching ChEMBL for {len(molecule_names)} molecules...")
    molecule_client = new_client.molecule  # type: ignore
    
    molecules_data = []
    
    for name in molecule_names:
        print(f"  Searching for: {name}")
        try:
            results = molecule_client.search(name)  # type: ignore
            
            if results:
                # Take the first/best match
                mol = results[0]
                
                molecule_info = {
                    "id": mol.get('molecule_chembl_id', f'CHEMBL_{name}'),
                    "name": name,
                    "smiles": mol.get('molecule_structures', {}).get('canonical_smiles', ''),
                    "inchi": mol.get('molecule_structures', {}).get('standard_inchi', ''),
                    "molecular_weight": mol.get('molecule_properties', {}).get('full_mwt', 0),
                    "logp": mol.get('molecule_properties', {}).get('alogp', 0),
                    "properties": mol.get('molecule_properties', {}),
                    "max_phase": mol.get('max_phase', 0),
                    "chembl_data": mol
                }
                
                molecules_data.append(molecule_info)
                print(f"    ✓ Found: {molecule_info['id']} (MW: {molecule_info['molecular_weight']})")
            else:
                print(f"    ⚠ Not found in ChEMBL")
                
        except Exception as e:
            print(f"    ❌ Error: {str(e)}")
    
    return molecules_data


def search_coffee_compounds() -> List[Dict]:
    """
    Search for coffee-related compounds in ChEMBL
    
    Returns:
        List of molecule data
    """
    # Extended list of 100+ coffee compounds
    coffee_molecules = [
        # Methylxanthines (10 compounds)
        "Caffeine", "Theobromine", "Theophylline", "Paraxanthine", "Theacrine",
        "1-Methylxanthine", "3-Methylxanthine", "7-Methylxanthine", "1,7-Dimethylxanthine", "1,3-Dimethyluric acid",
        
        # Chlorogenic acids (20 compounds)
        "Chlorogenic acid", "5-Caffeoylquinic acid", "3-Caffeoylquinic acid", "4-Caffeoylquinic acid",
        "3,4-Dicaffeoylquinic acid", "3,5-Dicaffeoylquinic acid", "4,5-Dicaffeoylquinic acid",
        "Feruloylquinic acid", "3-Feruloylquinic acid", "5-Feruloylquinic acid", "4-Feruloylquinic acid",
        "p-Coumaroylquinic acid", "3-p-Coumaroylquinic acid", "5-p-Coumaroylquinic acid",
        "Caffeoylshikimic acid", "Feruloylshikimic acid",
        
        # Phenolic acids (25 compounds)
        "Caffeic acid", "Ferulic acid", "p-Coumaric acid", "Sinapic acid", "Gallic acid",
        "Protocatechuic acid", "Vanillic acid", "Syringic acid", "p-Hydroxybenzoic acid",
        "3,4-Dihydroxybenzoic acid", "3,5-Dihydroxybenzoic acid", "Gentisic acid",
        "Salicylic acid", "o-Coumaric acid", "m-Coumaric acid", "Isoferulic acid",
        "Dihydrocaffeic acid", "Dihydroferulic acid", "Methyl caffeate", "Ethyl caffeate",
        "Caffeic acid phenethyl ester", "Rosmarinic acid", "Chicoric acid", "Caftaric acid", "Coutaric acid",
        
        # Quinic acid derivatives (5 compounds)
        "Quinic acid", "Shikimic acid", "3,4-Dihydroxycinnamic acid", "Quinide", "Epi-quinic acid",
        
        # Alkaloids (10 compounds)
        "Trigonelline", "N-Methylpyridinium", "Nicotinic acid", "Nicotinamide",
        "Pyridine", "N-Methylnicotinamide", "Cotinine", "Anabasine", "Nornicotine", "Anatabine",
        
        # Diterpenes (15 compounds)
        "Cafestol", "Kahweol", "16-O-Methylcafestol", "Cafestol palmitate", "Kahweol palmitate",
        "Cafestol linoleate", "Kahweol linoleate", "Atractyligenin", "16-O-Methylkahweol",
        "Dehydrocafestol", "Dehydrokahweol", "Cafestol acetate", "Kahweol acetate",
        
        # Flavonoids (20 compounds)
        "Quercetin", "Kaempferol", "Rutin", "Apigenin", "Luteolin", "Catechin", "Epicatechin",
        "Epigallocatechin", "Epigallocatechin gallate", "Epicatechin gallate",
        "Myricetin", "Isorhamnetin", "Naringenin", "Naringin", "Hesperidin", "Hesperetin",
        "Eriodictyol", "Taxifolin", "Fisetin", "Morin",
        
        # Lignans (8 compounds)
        "Pinoresinol", "Medioresinol", "Secoisolariciresinol", "Matairesinol",
        "Lariciresinol", "Syringaresinol", "Sesamin", "Sesamolin",
        
        # Amino acids (15 compounds)
        "L-Glutamic acid", "L-Aspartic acid", "L-Alanine", "L-Leucine", "L-Proline",
        "Gamma-Aminobutyric acid", "L-Theanine", "L-Lysine", "L-Arginine", "L-Histidine",
        "L-Phenylalanine", "L-Tyrosine", "L-Tryptophan", "L-Serine", "L-Threonine",
        
        # Carbohydrates (10 compounds)
        "Sucrose", "Glucose", "Fructose", "Arabinose", "Galactose", "Mannose",
        "Ribose", "Xylose", "Rhamnose", "Maltose",
        
        # Organic acids (15 compounds)
        "Citric acid", "Malic acid", "Acetic acid", "Lactic acid", "Tartaric acid",
        "Oxalic acid", "Succinic acid", "Fumaric acid", "Phosphoric acid", "Formic acid",
        "Propionic acid", "Butyric acid", "Pyruvic acid", "Ascorbic acid", "Gluconic acid",
        
        # Vitamins (8 compounds)
        "Niacin", "Riboflavin", "Pantothenic acid", "Pyridoxine", "Thiamine",
        "Biotin", "Folic acid", "Tocopherol",
        
        # Additional bioactive compounds (20 compounds)
        "5-Hydroxymethylfurfural", "Furfuryl alcohol", "Hydroxycinnamic acid",
        "Melanoidin precursor", "Acetoin", "Acetyl methyl carbinol",
        "2-Acetyl-1-pyrroline", "Sotolon", "Furaneol", "Homofuraneol",
        "Maltol", "Cyclotene", "Abhexon", "Norfuraneol", "Mesifurane",
        "4-Hydroxy-2,5-dimethyl-3(2H)-furanone", "2-Ethyl-3,5-dimethylpyrazine",
        "2,3-Diethyl-5-methylpyrazine", "Trimethylpyrazine", "Tetramethylpyrazine"
    ]
    
    print(f"Searching ChEMBL for {len(coffee_molecules)} coffee compounds...")
    return search_molecules_by_name(coffee_molecules)


def search_flavor_aroma_compounds() -> List[Dict]:
    """
    Search for coffee flavor and aroma compounds
    
    Returns:
        List of molecule data
    """
    # Extended list of 200+ flavor and aroma compounds
    flavor_molecules = [
        # Furans (30 compounds)
        "2-Methylfuran", "Furfural", "5-Methylfurfural", "Furfuryl alcohol", "2-Acetylfuran",
        "5-Hydroxymethylfurfural", "2-Furfurylthiol", "Furfuryl acetate", "Furfuryl propionate",
        "2-Pentylfuran", "2-Ethylfuran", "2,5-Dimethylfuran", "Tetrahydrofuran", "2-Furoic acid",
        "3-Methylfuran", "2-Proprylfuran", "2-Butylfuran", "Difurfuryl disulfide", "Difurfuryl ether",
        "2-Vinylfuran", "3-Acetylfuran", "Furaneol", "Homofuraneol", "Norfuraneol", "Mesifurane",
        "4-Hydroxy-2,5-dimethyl-3(2H)-furanone", "Maltol", "Ethyl maltol", "Cyclotene", "Abhexon",
        
        # Pyrazines (40 compounds)
        "2-Methylpyrazine", "2,5-Dimethylpyrazine", "2,6-Dimethylpyrazine", "2,3-Dimethylpyrazine",
        "Trimethylpyrazine", "Tetramethylpyrazine", "2-Ethylpyrazine", "2-Ethyl-3-methylpyrazine",
        "2-Ethyl-5-methylpyrazine", "2-Ethyl-6-methylpyrazine", "2,3-Diethylpyrazine",
        "2-Ethyl-3,5-dimethylpyrazine", "2-Ethyl-3,6-dimethylpyrazine", "2,3-Diethyl-5-methylpyrazine",
        "2-Isobutyl-3-methylpyrazine", "2-Isopropyl-3-methylpyrazine", "2-sec-Butyl-3-methylpyrazine",
        "2-Propylpyrazine", "2-Butylpyrazine", "2-Pentylpyrazine", "2-Hexylpyrazine",
        "2-Methyl-6-vinylpyrazine", "2-Acetylpyrazine", "2-Methoxy-3-isopropylpyrazine",
        "2-Methoxy-3-isobutylpyrazine", "2-Methoxy-3-methylpyrazine", "2-Methoxy-3-ethylpyrazine",
        "2,5-Diethylpyrazine", "2,6-Diethylpyrazine", "3,5-Diethyl-2-methylpyrazine",
        "2-Vinyl-6-methylpyrazine", "2-Ethyl-3-methoxypyrazine", "Quinoxaline",
        "2-Methylquinoxaline", "2,3-Dimethylquinoxaline", "2-Ethylquinoxaline",
        "6-Methylquinoxaline", "2,3,5-Trimethylpyrazine", "2,3,5,6-Tetramethylpyrazine",
        "2-Furfurylpyrazine",
        
        # Pyridines (20 compounds)
        "Pyridine", "2-Methylpyridine", "3-Methylpyridine", "4-Methylpyridine",
        "2-Ethylpyridine", "3-Ethylpyridine", "4-Ethylpyridine", "2,3-Dimethylpyridine",
        "2,4-Dimethylpyridine", "2,5-Dimethylpyridine", "2,6-Dimethylpyridine", "3,4-Dimethylpyridine",
        "3,5-Dimethylpyridine", "2-Acetylpyridine", "3-Acetylpyridine", "2-Propylpyridine",
        "2-Butylpyridine", "2-Pentylpyridine", "2-Vinylpyridine", "Nicotinic acid",
        
        # Phenols and Guaiacols (30 compounds)
        "Guaiacol", "4-Ethylguaiacol", "4-Vinylguaiacol", "4-Propylguaiacol", "4-Methylguaiacol",
        "Eugenol", "Isoeugenol", "Vanillin", "Ethyl vanillin", "Acetovanillone", "Vanillic acid",
        "Syringol", "4-Ethylsyringol", "4-Vinylsyringol", "4-Methylsyringol", "Syringaldehyde",
        "Phenol", "o-Cresol", "m-Cresol", "p-Cresol", "2-Ethylphenol", "3-Ethylphenol", "4-Ethylphenol",
        "2,4-Dimethylphenol", "2,5-Dimethylphenol", "2,6-Dimethylphenol", "3,4-Dimethylphenol",
        "4-Vinylphenol", "Catechol", "4-Methylcatechol",
        
        # Aldehydes (25 compounds)
        "Acetaldehyde", "Propanal", "Butanal", "Pentanal", "Hexanal", "Heptanal", "Octanal",
        "Nonanal", "Decanal", "Benzaldehyde", "2-Methylbutanal", "3-Methylbutanal", "Isovaleraldehyde",
        "2-Methylpropanal", "2-Ethylhexanal", "Phenylacetaldehyde", "3-Phenylpropanal",
        "Cinnamaldehyde", "Salicylaldehyde", "Anisaldehyde", "p-Tolualdehyde", "o-Tolualdehyde",
        "m-Tolualdehyde", "2-Furfural", "Methional",
        
        # Ketones (20 compounds)
        "Diacetyl", "Acetoin", "2,3-Pentanedione", "2,3-Hexanedione", "2,3-Heptanedione",
        "Acetone", "2-Butanone", "2-Pentanone", "3-Pentanone", "2-Hexanone", "3-Hexanone",
        "2-Heptanone", "3-Heptanone", "2-Octanone", "3-Octanone", "2-Nonanone",
        "Acetophenone", "Propiophenone", "Butyrophenone", "1-Phenyl-2-propanone",
        
        # Esters (25 compounds)
        "Ethyl acetate", "Methyl acetate", "Propyl acetate", "Butyl acetate", "Isobutyl acetate",
        "Pentyl acetate", "Hexyl acetate", "Ethyl propionate", "Ethyl butyrate", "Ethyl isobutyrate",
        "Ethyl valerate", "Ethyl isovalerate", "Ethyl hexanoate", "Ethyl heptanoate", "Ethyl octanoate",
        "Methyl butyrate", "Methyl hexanoate", "Ethyl benzoate", "Methyl benzoate",
        "Ethyl phenylacetate", "Ethyl cinnamate", "Benzyl acetate", "Phenethyl acetate",
        "Isoamyl acetate", "Gamma-lactone",
        
        # Thiols and Sulfur compounds (15 compounds)
        "2-Furfurylthiol", "Methanethiol", "Ethanethiol", "3-Mercapto-3-methylbutyl formate",
        "3-Mercaptohexanol", "3-Mercaptohexyl acetate", "Dimethyl sulfide", "Dimethyl disulfide",
        "Dimethyl trisulfide", "Methional", "2-Methyl-3-furanthiol", "Thiophene",
        "2-Methylthiophene", "3-Methylthiophene", "2-Acetylthiophene",
        
        # Lactones (10 compounds)
        "Gamma-butyrolactone", "Gamma-valerolactone", "Gamma-hexalactone", "Gamma-heptalactone",
        "Gamma-octalactone", "Gamma-nonalactone", "Gamma-decalactone", "Delta-decalactone",
        "Whiskey lactone", "Massoia lactone",
        
        # Terpenes (15 compounds)
        "Limonene", "Linalool", "Alpha-terpineol", "Beta-pinene", "Alpha-pinene",
        "Myrcene", "Ocimene", "Terpinolene", "Geraniol", "Nerol", "Citronellol",
        "Beta-caryophyllene", "Alpha-humulene", "Nerolidol", "Farnesol"
    ]
    
    print(f"Searching ChEMBL for {len(flavor_molecules)} flavor and aroma compounds...")
    return search_molecules_by_name(flavor_molecules)


def search_roasting_compounds() -> List[Dict]:
    """
    Search for roasting byproduct compounds
    
    Returns:
        List of molecule data
    """
    # Maillard reaction products and roasting compounds (100+ molecules)
    roasting_compounds = [
        # Melanoidins precursors (20 compounds)
        "5-Hydroxymethylfurfural", "Furfural", "Furfuryl alcohol", "Hydroxymethylfurfural",
        "2-Furfurylthiol", "2-Acetylfuran", "5-Methylfurfural", "2-Methylfuran",
        "Difurfuryl disulfide", "2-Furoic acid", "3-Furoic acid", "2-Furaldehyde",
        "Furfuryl acetate", "Furfuryl propionate", "2-Pentylfuran", "2-Ethylfuran",
        "2,5-Dimethylfuran", "Difurfuryl ether", "2-Vinylfuran", "3-Acetylfuran",
        
        # Strecker aldehydes (15 compounds)
        "3-Methylbutanal", "2-Methylbutanal", "2-Methylpropanal", "Phenylacetaldehyde",
        "3-Phenylpropanal", "Methional", "2-Methylbenzaldehyde", "3-Methylbenzaldehyde",
        "4-Methylbenzaldehyde", "2-Ethylbenzaldehyde", "3-Ethylbenzaldehyde", "4-Ethylbenzaldehyde",
        "2,4-Dimethylbenzaldehyde", "2,5-Dimethylbenzaldehyde", "3,5-Dimethylbenzaldehyde",
        
        # Pyrroles (20 compounds)
        "Pyrrole", "2-Methylpyrrole", "3-Methylpyrrole", "2-Ethylpyrrole",
        "2,3-Dimethylpyrrole", "2,4-Dimethylpyrrole", "2,5-Dimethylpyrrole",
        "2-Formylpyrrole", "2-Acetylpyrrole", "2-Propionylpyrrole",
        "1-Methylpyrrole", "1-Ethylpyrrole", "2-Furfurylpyrrole",
        "2-Pyrrolecarboxaldehyde", "2-Pyrrolecarbonitrile", "2-Pyrrolidone",
        "N-Methylpyrrole", "2-Acetyl-1-pyrroline", "2-Propyl-1-pyrroline",
        "2-Pentyl-1-pyrroline",
        
        # Oxazoles and Thiazoles (25 compounds)
        "Oxazole", "2-Methyloxazole", "4-Methyloxazole", "5-Methyloxazole",
        "2,4-Dimethyloxazole", "2,5-Dimethyloxazole", "4,5-Dimethyloxazole",
        "2-Ethyloxazole", "4-Ethyloxazole", "5-Ethyloxazole",
        "Thiazole", "2-Methylthiazole", "4-Methylthiazole", "5-Methylthiazole",
        "2,4-Dimethylthiazole", "2,5-Dimethylthiazole", "4,5-Dimethylthiazole",
        "2-Ethylthiazole", "4-Ethylthiazole", "5-Ethylthiazole",
        "2-Acetylthiazole", "2-Isobutylthiazole", "Benzothiazole",
        "2-Methylbenzothiazole", "2-Ethylbenzothiazole",
        
        # Imidazoles (10 compounds)
        "Imidazole", "2-Methylimidazole", "4-Methylimidazole", "2-Ethylimidazole",
        "2,4-Dimethylimidazole", "2-Acetylimidazole", "Histamine",
        "1-Methylimidazole", "2-Isopropylimidazole", "Benzimidazole",
        
        # Sulfur heterocycles (15 compounds)
        "Thiophene", "2-Methylthiophene", "3-Methylthiophene", "2-Ethylthiophene",
        "2,5-Dimethylthiophene", "2,3-Dimethylthiophene", "2-Acetylthiophene",
        "2-Propylthiophene", "2-Butylthiophene", "2-Furfurylthiol",
        "3-Mercapto-3-methylbutyl formate", "2-Furanmethanethiol",
        "Tetrahydrothiophene", "Thianaphthene", "Benzothiophene",
        
        # Nitrogen heterocycles (10 compounds)
        "Pyrroline", "Pyrrolidine", "Piperidine", "Pyrrolidinone",
        "2-Pyrrolidinone", "N-Methylpyrrolidine", "N-Ethylpyrrolidine",
        "Indole", "Skatole", "3-Methylindole"
    ]
    
    print(f"Searching ChEMBL for {len(roasting_compounds)} roasting compounds...")
    return search_molecules_by_name(roasting_compounds)


def search_organic_acids() -> List[Dict]:
    """
    Search for organic acids found in coffee
    
    Returns:
        List of molecule data
    """
    # Comprehensive organic acids (80+ compounds)
    organic_acids = [
        # Aliphatic acids (30 compounds)
        "Acetic acid", "Propionic acid", "Butyric acid", "Isobutyric acid",
        "Valeric acid", "Isovaleric acid", "Caproic acid", "Enanthic acid",
        "Caprylic acid", "Pelargonic acid", "Capric acid", "Lauric acid",
        "Myristic acid", "Palmitic acid", "Stearic acid", "Oleic acid",
        "Linoleic acid", "Linolenic acid", "Arachidic acid", "Behenic acid",
        "Formic acid", "Glyoxylic acid", "Pyruvic acid", "Levulinic acid",
        "Adipic acid", "Pimelic acid", "Suberic acid", "Azelaic acid",
        "Sebacic acid", "Dodecanedioic acid",
        
        # Hydroxyl acids (20 compounds)
        "Lactic acid", "Glycolic acid", "Citric acid", "Isocitric acid",
        "Malic acid", "Tartaric acid", "Mucic acid", "Gluconic acid",
        "Glucuronic acid", "Galacturonic acid", "Ascorbic acid",
        "3-Hydroxybutyric acid", "Beta-hydroxybutyric acid",
        "2-Hydroxybutyric acid", "3-Hydroxypropanoic acid",
        "2-Hydroxypropanoic acid", "Glyceric acid", "Threonic acid",
        "Erythronic acid", "Ribonic acid",
        
        # Aromatic acids (20 compounds)
        "Benzoic acid", "Salicylic acid", "p-Hydroxybenzoic acid",
        "Protocatechuic acid", "Gentisic acid", "Gallic acid",
        "3,4-Dihydroxybenzoic acid", "3,5-Dihydroxybenzoic acid",
        "Vanillic acid", "Syringic acid", "Veratric acid",
        "Cinnamic acid", "o-Coumaric acid", "m-Coumaric acid", "p-Coumaric acid",
        "Caffeic acid", "Ferulic acid", "Sinapic acid", "Isoferulic acid",
        "Homogentisic acid",
        
        # Keto acids (10 compounds)
        "Pyruvic acid", "Oxaloacetic acid", "Alpha-ketoglutaric acid",
        "Acetoacetic acid", "Levulinic acid", "Phenylpyruvic acid",
        "p-Hydroxyphenylpyruvic acid", "Indolepyruvic acid",
        "2-Oxobutyric acid", "3-Methyl-2-oxovaleric acid"
    ]
    
    print(f"Searching ChEMBL for {len(organic_acids)} organic acids...")
    return search_molecules_by_name(organic_acids)


def search_bioactive_compounds() -> List[Dict]:
    """
    Search for bioactive compounds with health benefits
    
    Returns:
        List of molecule data
    """
    # Comprehensive bioactive molecules (100+ compounds)
    bioactive_compounds = [
        # Polyphenols (30 compounds)
        "Quercetin", "Kaempferol", "Rutin", "Myricetin", "Isorhamnetin",
        "Catechin", "Epicatechin", "Epigallocatechin", "Epigallocatechin gallate",
        "Epicatechin gallate", "Gallocatechin", "Gallocatechin gallate",
        "Procyanidin B1", "Procyanidin B2", "Procyanidin C1",
        "Resveratrol", "Pterostilbene", "Piceatannol", "Curcumin",
        "Ellagic acid", "Punicalagin", "Anthocyanin", "Cyanidin",
        "Delphinidin", "Pelargonidin", "Peonidin", "Malvidin",
        "Taxifolin", "Fisetin", "Morin",
        
        # Isoflavones (10 compounds)
        "Genistein", "Daidzein", "Glycitein", "Biochanin A", "Formononetin",
        "Puerarin", "Tectorigenin", "Prunetin", "Orobol", "Calycosin",
        
        # Lignans (10 compounds)
        "Secoisolariciresinol", "Matairesinol", "Pinoresinol", "Lariciresinol",
        "Medioresinol", "Syringaresinol", "Sesamin", "Sesamolin",
        "Enterolactone", "Enterodiol",
        
        # Terpenoids (20 compounds)
        "Beta-carotene", "Lycopene", "Lutein", "Zeaxanthin", "Astaxanthin",
        "Beta-cryptoxanthin", "Canthaxanthin", "Limonene", "Linalool",
        "Geraniol", "Nerol", "Citronellol", "Menthol", "Camphor",
        "Borneol", "Carvone", "Alpha-terpineol", "Terpinolene",
        "Myrcene", "Beta-pinene",
        
        # Alkaloids (20 compounds)
        "Caffeine", "Theobromine", "Theophylline", "Paraxanthine",
        "Trigonelline", "Nicotinic acid", "Nicotinamide", "Betaine",
        "Choline", "Carnitine", "Taurine", "Spermine", "Spermidine",
        "Putrescine", "Cadaverine", "Tyramine", "Octopamine",
        "Synephrine", "Hordenine", "N-Methyltyramine",
        
        # Glucosinolates and derivatives (10 compounds)
        "Sulforaphane", "Indole-3-carbinol", "Diindolylmethane",
        "Allyl isothiocyanate", "Benzyl isothiocyanate",
        "Phenethyl isothiocyanate", "Glucoraphanin", "Sinigrin",
        "Glucobrassicin", "Progoitrin"
    ]
    
    print(f"Searching ChEMBL for {len(bioactive_compounds)} bioactive compounds...")
    return search_molecules_by_name(bioactive_compounds)


def search_sugar_products() -> List[Dict]:
    """
    Search for sugar degradation products
    
    Returns:
        List of molecule data
    """
    # Sugar degradation and caramelization products (60+ compounds)
    sugar_products = [
        # Caramelization products (20 compounds)
        "Diacetyl", "Acetoin", "2,3-Butanedione", "2,3-Pentanedione",
        "2,3-Hexanedione", "2,3-Heptanedione", "Hydroxyacetone",
        "Hydroxymethylfurfural", "5-Hydroxymethylfurfural", "Maltol",
        "Ethyl maltol", "Cyclotene", "Furaneol", "Homofuraneol",
        "Norfuraneol", "Mesifurane", "Sotolon", "Abhexon",
        "4-Hydroxy-2,5-dimethyl-3(2H)-furanone", "5-Methyl-2-furancarboxaldehyde",
        
        # Furfurals and derivatives (20 compounds)
        "Furfural", "2-Furfural", "5-Methylfurfural", "5-Hydroxymethylfurfural",
        "Furfuryl alcohol", "2-Furaldehyde", "2-Acetylfuran", "2-Furoic acid",
        "3-Furoic acid", "2-Furanmethanol", "2-Furancarboxylic acid",
        "2-Furylmethyl ketone", "2-Methylfuran", "3-Methylfuran",
        "2-Ethylfuran", "2-Pentylfuran", "2,5-Dimethylfuran",
        "Tetrahydrofurfuryl alcohol", "2-Furfurylthiol", "Difurfuryl disulfide",
        
        # Reductones (10 compounds)
        "Ascorbic acid", "Erythorbic acid", "Dehydroascorbic acid",
        "Reductic acid", "3-Deoxyglucosone", "3-Deoxythreosone",
        "Glucosone", "Fructosone", "Galactosone", "Ribosone",
        
        # Other sugar products (10 compounds)
        "Levulinic acid", "Formic acid", "Acetol", "Pyruvaldehyde",
        "Glyoxal", "Methylglyoxal", "Diacetyl", "Acetoin",
        "Hydroxyacetaldehyde", "Glycolaldehyde"
    ]
    
    print(f"Searching ChEMBL for {len(sugar_products)} sugar degradation products...")
    return search_molecules_by_name(sugar_products)


def search_lipid_compounds() -> List[Dict]:
    """
    Search for lipid-derived compounds
    
    Returns:
        List of molecule data
    """
    # Lipids and fatty acid derivatives (70+ compounds)
    lipid_compounds = [
        # Fatty acids (30 compounds)
        "Palmitic acid", "Stearic acid", "Oleic acid", "Linoleic acid",
        "Linolenic acid", "Alpha-linolenic acid", "Gamma-linolenic acid",
        "Arachidonic acid", "Eicosapentaenoic acid", "Docosahexaenoic acid",
        "Myristic acid", "Lauric acid", "Capric acid", "Caprylic acid",
        "Caproic acid", "Butyric acid", "Behenic acid", "Lignoceric acid",
        "Nervonic acid", "Erucic acid", "Gadoleic acid", "Palmitoleic acid",
        "Vaccenic acid", "Elaidic acid", "Petroselinic acid",
        "Conjugated linoleic acid", "Punicic acid", "Calendic acid",
        "Eleostearic acid", "Parinaric acid",
        
        # Phospholipids (15 compounds)
        "Phosphatidylcholine", "Phosphatidylethanolamine",
        "Phosphatidylserine", "Phosphatidylinositol",
        "Phosphatidylglycerol", "Cardiolipin", "Sphingomyelin",
        "Lyso-phosphatidylcholine", "Lysophosphatidylethanolamine",
        "Platelet-activating factor", "Ceramide", "Sphingosine",
        "Ceramide-1-phosphate", "Glucosylceramide", "Galactosylceramide",
        
        # Sterols and related (15 compounds)
        "Cholesterol", "Stigmasterol", "Beta-sitosterol", "Campesterol",
        "Ergosterol", "7-Dehydrocholesterol", "Lanosterol",
        "Squalene", "Desmosterol", "Lathosterol", "Coprostanol",
        "Cholestanol", "Cholestanone", "Pregnenolone", "Progesterone",
        
        # Oxidized lipids (10 compounds)
        "9-Hydroxyoctadecadienoic acid", "13-Hydroxyoctadecadienoic acid",
        "15-Hydroxyeicosatetraenoic acid", "5-Hydroxyeicosatetraenoic acid",
        "Lipoxin A4", "Lipoxin B4", "Resolvin D1", "Resolvin E1",
        "Neuroprotectin D1", "Maresins"
    ]
    
    print(f"Searching ChEMBL for {len(lipid_compounds)} lipid-derived compounds...")
    return search_molecules_by_name(lipid_compounds)


def get_bioactivities(chembl_id: str, max_activities: int = 5) -> List[Dict]:
    """
    Get bioactivity data for a molecule
    
    Args:
        chembl_id: ChEMBL molecule ID
        max_activities: Maximum number of activities to retrieve
    
    Returns:
        List of activity data
    """
    try:
        activity_client = new_client.activity  # type: ignore
        activities = activity_client.filter(molecule_chembl_id=chembl_id).only(
            'target_chembl_id',
            'target_pref_name', 
            'standard_type',
            'standard_value',
            'standard_units',
            'pchembl_value'
        )
        
        activity_list = []
        for i, act in enumerate(activities):
            if i >= max_activities:
                break
            
            activity_list.append({
                'target': act.get('target_pref_name', 'Unknown'),
                'type': act.get('standard_type', ''),
                'value': act.get('standard_value', ''),
                'units': act.get('standard_units', ''),
                'pchembl': act.get('pchembl_value', '')
            })
        
        return activity_list
    except:
        return []


def create_training_text(molecule: Dict, category: str) -> str:
    """
    Create natural language training text from molecule data
    
    Args:
        molecule: Molecule data dictionary
        category: Category (caffeine_compounds, antioxidants, etc.)
    
    Returns:
        Training text string
    """
    name = molecule['name']
    mol_weight = molecule['molecular_weight']
    logp = molecule['logp']
    smiles = molecule['smiles']
    
    # Convert to float if string
    try:
        mol_weight_float = float(mol_weight) if mol_weight else 0.0
    except (ValueError, TypeError):
        mol_weight_float = 0.0
    
    try:
        logp_float = float(logp) if logp else 0.0
    except (ValueError, TypeError):
        logp_float = 0.0
    
    # Base description
    if mol_weight_float > 0:
        text = f"{name} is a molecule with molecular weight {mol_weight_float:.2f} Da"
    else:
        text = f"{name} is a molecule"
    
    if logp_float != 0.0:
        text += f" and logP value of {logp_float:.2f}"
    
    text += f". Its SMILES notation is {smiles}. "
    
    # Add category-specific information
    if category == "caffeine_compounds":
        text += f"{name} is a methylxanthine alkaloid found in coffee that acts as a central nervous system stimulant. "
    elif category == "antioxidants":
        text += f"{name} is a polyphenol with antioxidant properties found in coffee. "
    elif category == "flavor_molecules":
        text += f"{name} is a volatile compound that contributes to coffee's aroma and flavor profile. "
    elif category == "aroma_compounds":
        text += f"{name} is an important aroma compound formed during coffee roasting. "
    elif category == "bioactive_compounds":
        text += f"{name} is a bioactive compound with potential health benefits. "
    elif category == "organic_acids":
        text += f"{name} is an organic acid that contributes to coffee's acidity and flavor complexity. "
    
    return text


def create_training_prompts(molecules_data: List[Dict]) -> List[Dict]:
    """
    Create Q&A training prompts from molecule data
    
    Args:
        molecules_data: List of molecule data
    
    Returns:
        List of prompt-response pairs
    """
    prompts = []
    
    for mol in molecules_data[:10]:  # Use first 10 molecules
        name = mol['name']
        mol_weight = mol['molecular_weight']
        smiles = mol['smiles']
        logp = mol['logp']
        
        # Structure question
        prompts.append({
            "prompt": f"What is the molecular structure of {name}?",
            "response": f"{name} has a molecular weight of {mol_weight:.2f} Da. Its SMILES notation is {smiles}, which represents its chemical structure with atoms and bonds."
        })
        
        # Properties question
        if logp:
            prompts.append({
                "prompt": f"What are the chemical properties of {name}?",
                "response": f"{name} has a molecular weight of {mol_weight:.2f} Da and a logP (lipophilicity) value of {logp:.2f}. This indicates its solubility characteristics and ability to cross biological membranes."
            })
    
    return prompts


def format_chembl_json(molecules_data: List[Dict], categories: Dict[str, str]) -> Dict:
    """
    Format molecule data into ChemBL training JSON format
    
    Args:
        molecules_data: List of molecule data
        categories: Dictionary mapping molecule names to categories
    
    Returns:
        Formatted JSON data
    """
    formatted_molecules = []
    
    for mol_data in molecules_data:
        name = mol_data['name']
        category = categories.get(name, 'other')
        
        # Create simplified atom list (just for structure)
        atoms = []
        bonds = []
        
        # Parse SMILES to create simple atom/bond lists (simplified)
        smiles = mol_data['smiles']
        if smiles:
            # This is a simplified representation
            for i, char in enumerate(smiles[:20]):  # Limit to 20 chars
                if char.isalpha():
                    atoms.append({"type": char, "id": len(atoms)})
        
        formatted_mol = {
            "id": mol_data['id'],
            "name": name,
            "smiles": smiles,
            "inchi": mol_data.get('inchi', ''),
            "molecular_weight": mol_data['molecular_weight'],
            "logp": mol_data['logp'],
            "properties": {
                "category": category,
                "description": f"Coffee-related compound: {name}",
                "biological_activity": "See ChEMBL database for detailed bioactivity",
                "concentration_in_coffee": "Varies by coffee type and processing"
            },
            "atoms": atoms,
            "bonds": bonds,
            "training_text": create_training_text(mol_data, category)
        }
        
        formatted_molecules.append(formatted_mol)
    
    # Create training prompts
    training_prompts = create_training_prompts(molecules_data)
    
    # Assemble final JSON
    output = {
        "metadata": {
            "source": "ChEMBL Database",
            "description": "Molecular chemistry training data for Tanka Chemistry Mode (Ultimate subscription)",
            "format_version": "1.0",
            "total_molecules": len(formatted_molecules),
            "categories": list(set(categories.values()))
        },
        "molecules": formatted_molecules,
        "training_prompts": training_prompts
    }
    
    return output


def download_chembl_data(
    output_file: Optional[Path] = None,
    max_molecules: Optional[int] = None
) -> int:
    """
    Main function to download ChEMBL data
    
    Args:
        output_file: Path to save JSON file (default: data/chembl-training.json)
        max_molecules: Maximum number of molecules to download
    
    Returns:
        Number of molecules downloaded
    """
    print("=" * 80)
    print("ChEMBL Data Download for Tanka Chemistry Mode")
    print("=" * 80)
    print()
    
    if output_file is None:
        output_file = OUTPUT_FILE
    
    # Search for coffee-related compounds
    print("1. Searching for coffee compounds...")
    coffee_data = search_coffee_compounds()
    print(f"   Found {len(coffee_data)} coffee compounds\n")
    
    # Search for flavor/aroma compounds
    print("2. Searching for flavor and aroma compounds...")
    flavor_data = search_flavor_aroma_compounds()
    print(f"   Found {len(flavor_data)} flavor/aroma compounds\n")
    
    # Search for roasting compounds
    print("3. Searching for roasting byproducts...")
    roasting_data = search_roasting_compounds()
    print(f"   Found {len(roasting_data)} roasting compounds\n")
    
    # Search for organic acids
    print("4. Searching for organic acids...")
    acid_data = search_organic_acids()
    print(f"   Found {len(acid_data)} organic acids\n")
    
    # Search for bioactive compounds
    print("5. Searching for bioactive compounds...")
    bioactive_data = search_bioactive_compounds()
    print(f"   Found {len(bioactive_data)} bioactive compounds\n")
    
    # Search for sugar products
    print("6. Searching for sugar degradation products...")
    sugar_data = search_sugar_products()
    print(f"   Found {len(sugar_data)} sugar products\n")
    
    # Search for lipid compounds
    print("7. Searching for lipid-derived compounds...")
    lipid_data = search_lipid_compounds()
    print(f"   Found {len(lipid_data)} lipid compounds\n")
    
    # Combine all molecules
    all_molecules = (coffee_data + flavor_data + roasting_data + 
                    acid_data + bioactive_data + sugar_data + lipid_data)
    
    # Remove duplicates by ChEMBL ID
    seen_ids = set()
    unique_molecules = []
    for mol in all_molecules:
        if mol['id'] not in seen_ids:
            seen_ids.add(mol['id'])
            unique_molecules.append(mol)
    
    all_molecules = unique_molecules
    
    if max_molecules:
        all_molecules = all_molecules[:max_molecules]
    
    print(f"Total unique molecules collected: {len(all_molecules)}\n")
    
    if not all_molecules:
        print("❌ No molecules found. Exiting.")
        return 0
    
    # Create category mapping
    categories = {}
    
    # Categorize coffee compounds
    caffeine_names = ["Caffeine", "Theobromine", "Theophylline", "Paraxanthine", "Theacrine"]
    antioxidant_names = ["Chlorogenic acid", "Caffeic acid", "Ferulic acid", "Quercetin", "Catechin"]
    
    for mol in coffee_data:
        name = mol['name']
        if any(caff in name for caff in caffeine_names):
            categories[name] = "caffeine_compounds"
        elif any(anti in name for anti in antioxidant_names):
            categories[name] = "antioxidants"
        else:
            categories[name] = "bioactive_compounds"
    
    # Categorize other compounds
    for mol in flavor_data:
        categories[mol['name']] = "flavor_molecules"
    
    for mol in roasting_data:
        categories[mol['name']] = "aroma_compounds"
    
    for mol in acid_data:
        categories[mol['name']] = "organic_acids"
    
    for mol in bioactive_data:
        categories[mol['name']] = "bioactive_compounds"
    
    for mol in sugar_data:
        categories[mol['name']] = "flavor_molecules"
    
    for mol in lipid_data:
        categories[mol['name']] = "bioactive_compounds"
    
    # Format data
    print("8. Formatting data into training JSON...")
    formatted_data = format_chembl_json(all_molecules, categories)
    
    # Save to file
    print(f"9. Saving to {output_file}...")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(formatted_data, f, indent=2, ensure_ascii=False)
    
    print()
    print("=" * 80)
    print("✅ Download Complete!")
    print("=" * 80)
    print(f"Molecules: {len(all_molecules)}")
    print(f"Training prompts: {len(formatted_data['training_prompts'])}")
    print(f"Output file: {output_file}")
    print()
    print("You can now use this data to train Tanka Chemistry Mode:")
    print("  python train_chemistry.py")
    print()
    
    return len(all_molecules)


def main():
    """Main entry point with CLI"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Download coffee-related molecular data from ChEMBL'
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=OUTPUT_FILE,
        help='Output JSON file path'
    )
    parser.add_argument(
        '--max-molecules',
        type=int,
        default=None,
        help='Maximum number of molecules to download'
    )
    
    args = parser.parse_args()
    
    try:
        num_molecules = download_chembl_data(
            output_file=args.output,
            max_molecules=args.max_molecules
        )
        
        if num_molecules > 0:
            sys.exit(0)
        else:
            sys.exit(1)
            
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
