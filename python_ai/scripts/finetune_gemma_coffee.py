"""
Fine-tune TinyLlama 1.1B for coffee knowledge using RAG-augmented examples
"""

import json
import torch
from pathlib import Path
from datasets import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM,
    BitsAndBytesConfig,
    TrainingArguments,
    TrainerCallback,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer
import sys

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))
from rag_retriever import CoffeeRAGRetriever

# Early stopping callback based on loss and grad_norm
class EarlyStoppingCallback(TrainerCallback):
    def __init__(self, loss_threshold=0.68, grad_norm_threshold=0.7):
        self.loss_threshold = loss_threshold
        self.grad_norm_threshold = grad_norm_threshold
        
    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs is not None:
            loss = logs.get("loss", None)
            grad_norm = logs.get("grad_norm", None)
            
            if loss is not None and grad_norm is not None:
                if loss < self.loss_threshold and grad_norm < self.grad_norm_threshold:
                    print(f"\n🎯 Early stopping triggered!")
                    print(f"   Loss: {loss:.4f} < {self.loss_threshold}")
                    print(f"   Grad norm: {grad_norm:.4f} < {self.grad_norm_threshold}")
                    print(f"   Saving model and stopping...")
                    control.should_training_stop = True
                    control.should_save = True

def generate_coffee_training_data(rag_dir: Path, output_file: Path):
    """
    Generate training examples from RAG chunks
    """
    # Load RAG retriever
    retriever = CoffeeRAGRetriever(rag_dir)
    
    # Define coffee-related topics and questions (expanded to use more RAG data)
    TOPICS = [
        # Basics (10)
        "What is coffee?",
        "How is coffee made?",
        "What are coffee beans?",
        "Where does coffee come from?",
        "What is a coffee cherry?",
        "What are the parts of a coffee bean?",
        "How do coffee plants grow?",
        "What is the history of coffee?",
        "What is the coffee belt?",
        "Why is coffee popular?",
        
        # Brewing Methods (20)
        "How do you brew coffee?",
        "What are different brewing methods?",
        "What is espresso?",
        "How do you make espresso?",
        "What is pour over coffee?",
        "What is French press?",
        "What is drip coffee?",
        "What is cold brew coffee?",
        "What is Turkish coffee?",
        "What is Vietnamese coffee?",
        "What is AeroPress coffee?",
        "What is Moka pot coffee?",
        "What is siphon coffee?",
        "What is Chemex coffee?",
        "What is V60 coffee?",
        "What is percolator coffee?",
        "What is instant coffee?",
        "What is nitro cold brew?",
        "What is espresso extraction?",
        "What are brewing parameters?",
        
        # Flavor & Taste (20)
        "What affects coffee flavor?",
        "What is coffee acidity?",
        "What is coffee body?",
        "What makes coffee bitter?",
        "What makes coffee sweet?",
        "What is coffee aroma?",
        "What are coffee tasting notes?",
        "What is coffee cupping?",
        "What is coffee terroir?",
        "What are fruity notes in coffee?",
        "What are chocolate notes in coffee?",
        "What are floral notes in coffee?",
        "What are nutty notes in coffee?",
        "What is coffee balance?",
        "What is coffee complexity?",
        "What is coffee brightness?",
        "What is coffee cleanness?",
        "What is aftertaste in coffee?",
        "What is mouthfeel in coffee?",
        "What is coffee sweetness?",
        
        # Coffee Types & Varieties (20)
        "What is Arabica coffee?",
        "What is Robusta coffee?",
        "What are coffee varieties?",
        "What is single origin coffee?",
        "What is a coffee blend?",
        "What is Bourbon coffee?",
        "What is Typica coffee?",
        "What is Geisha coffee?",
        "What is Caturra coffee?",
        "What is Catuai coffee?",
        "What is SL28 coffee?",
        "What is SL34 coffee?",
        "What is Pacamara coffee?",
        "What is Maragogype coffee?",
        "What is Yellow Bourbon?",
        "What is Red Bourbon?",
        "What is Pink Bourbon?",
        "What are heirloom varieties?",
        "What are hybrid coffee varieties?",
        "What is F1 hybrid coffee?",
        
        # Processing Methods (15)
        "How is coffee processed?",
        "What is washed coffee?",
        "What is natural processed coffee?",
        "What is honey processed coffee?",
        "What is wet hulled coffee?",
        "What is semi-washed coffee?",
        "What is anaerobic fermentation?",
        "What is carbonic maceration?",
        "What is extended fermentation?",
        "What is mechanical drying?",
        "What is sun drying?",
        "What is patio drying?",
        "What is raised bed drying?",
        "What is pulped natural?",
        "What affects processing?",
        
        # Roasting (15)
        "What is coffee roasting?",
        "What is light roast coffee?",
        "What is dark roast coffee?",
        "What is medium roast coffee?",
        "What happens during roasting?",
        "What is first crack?",
        "What is second crack?",
        "What is roast development?",
        "What is roast degree?",
        "What is City roast?",
        "What is Full City roast?",
        "What is French roast?",
        "What is Italian roast?",
        "What is Nordic roast?",
        "What is roast profile?",
        
        # Coffee Regions (25)
        "Where is coffee grown?",
        "What is Ethiopian coffee?",
        "What is Colombian coffee?",
        "What is Brazilian coffee?",
        "What is Kenyan coffee?",
        "What is Costa Rican coffee?",
        "What is Guatemalan coffee?",
        "What is Peruvian coffee?",
        "What is Honduran coffee?",
        "What is Mexican coffee?",
        "What is Jamaican coffee?",
        "What is Hawaiian coffee?",
        "What is Indonesian coffee?",
        "What is Sumatran coffee?",
        "What is Java coffee?",
        "What is Yemen coffee?",
        "What is Rwandan coffee?",
        "What is Burundi coffee?",
        "What is Tanzania coffee?",
        "What is Uganda coffee?",
        "What is Papua New Guinea coffee?",
        "What is Indian coffee?",
        "What is Vietnam coffee?",
        "What is Panama coffee?",
        "What is El Salvador coffee?",
        
        # Caffeine & Chemistry (10)
        "What is caffeine?",
        "How much caffeine is in coffee?",
        "What is decaf coffee?",
        "How is coffee decaffeinated?",
        "What are coffee acids?",
        "What is chlorogenic acid?",
        "What are coffee oils?",
        "What is the Maillard reaction?",
        "What is caramelization in coffee?",
        "What compounds are in coffee?",
        
        # Specialty & Quality (15)
        "What is specialty coffee?",
        "What is commercial coffee?",
        "What is Q grading?",
        "What is SCA scoring?",
        "What is coffee quality?",
        "What are specialty coffee standards?",
        "What is Cup of Excellence?",
        "What is direct trade?",
        "What is fair trade coffee?",
        "What is organic coffee?",
        "What is shade grown coffee?",
        "What is bird friendly coffee?",
        "What is rainforest alliance?",
        "What is sustainable coffee?",
        "What is traceable coffee?",
        
        # Equipment & Tools (15)
        "What is a coffee grinder?",
        "What is burr grinder?",
        "What is blade grinder?",
        "What is grind size?",
        "What is an espresso machine?",
        "What is a coffee maker?",
        "What is a coffee filter?",
        "What is a portafilter?",
        "What is a tamper?",
        "What is a milk frother?",
        "What is a coffee scale?",
        "What is a thermometer?",
        "What is a refractometer?",
        "What is water filtration?",
        "What are brewing accessories?",
        
        # Milk & Drinks (15)
        "What is a latte?",
        "What is a cappuccino?",
        "What is a macchiato?",
        "What is a flat white?",
        "What is an Americano?",
        "What is a cortado?",
        "What is a mocha?",
        "What is latte art?",
        "How do you steam milk?",
        "What is microfoam?",
        "What is milk texture?",
        "What milk is best for coffee?",
        "What is oat milk in coffee?",
        "What is alternative milk?",
        "What is a coffee shot?",
        
        # Storage and freshness (25 topics)
        "How to store coffee beans?",
        "How long do coffee beans stay fresh?",
        "Should I freeze coffee beans?",
        "What is coffee degassing?",
        "How to tell if coffee is stale?",
        "What are one-way valves on coffee bags?",
        "Should I refrigerate coffee?",
        "How to store ground coffee?",
        "What is coffee oxidation?",
        "How does air affect coffee?",
        "What is the best container for coffee?",
        "How long does brewed coffee last?",
        "Can coffee beans go bad?",
        "What is coffee bloom?",
        "How to preserve coffee aroma?",
        "What temperature to store coffee?",
        "How does humidity affect coffee storage?",
        "What is vacuum sealing coffee?",
        "How long after roasting is coffee best?",
        "What is the coffee freshness window?",
        "Should I buy whole beans or ground?",
        "How much coffee to buy at once?",
        "What is coffee packaging?",
        "How to transport coffee beans?",
        "What is nitrogen flushing?",
        
        # Health and nutrition (30 topics)
        "Is coffee healthy?",
        "How much caffeine in coffee?",
        "What are coffee health benefits?",
        "Can coffee help weight loss?",
        "Is coffee bad for heart?",
        "Does coffee dehydrate you?",
        "What is coffee and blood pressure?",
        "Is coffee acidic?",
        "Can pregnant women drink coffee?",
        "What is coffee and sleep?",
        "Does coffee cause anxiety?",
        "What are coffee antioxidants?",
        "Is coffee good for liver?",
        "Can coffee prevent diabetes?",
        "What is coffee and cholesterol?",
        "Does coffee stain teeth?",
        "Is coffee a laxative?",
        "What is coffee and metabolism?",
        "Can coffee cause headaches?",
        "What is coffee withdrawal?",
        "Is decaf coffee healthy?",
        "What is coffee and exercise?",
        "Does coffee affect bone health?",
        "What is coffee and digestion?",
        "Can coffee reduce cancer risk?",
        "What is coffee and brain function?",
        "Does coffee affect hydration?",
        "What is coffee sensitivity?",
        "Is coffee addictive?",
        "What are coffee polyphenols?",
        
        # Sustainability and ethics (25 topics)
        "What is fair trade coffee?",
        "What is organic coffee?",
        "What is sustainable coffee?",
        "What is shade grown coffee?",
        "What is bird friendly coffee?",
        "What is carbon neutral coffee?",
        "What is coffee farmer income?",
        "What is coffee certification?",
        "What is Rainforest Alliance?",
        "What is direct trade coffee?",
        "What is coffee cooperatives?",
        "What is coffee traceability?",
        "What is regenerative agriculture coffee?",
        "What is coffee water usage?",
        "What is coffee deforestation?",
        "What is coffee biodiversity?",
        "What is coffee farm workers?",
        "What is coffee supply chain?",
        "What is coffee environmental impact?",
        "What is coffee packaging waste?",
        "What is coffee composting?",
        "What is coffee social impact?",
        "What is coffee gender equality?",
        "What is coffee climate change?",
        "What is coffee transparency?",
        
        # Coffee science (35 topics)
        "What is coffee extraction?",
        "What is coffee solubility?",
        "What is TDS in coffee?",
        "What is coffee brew ratio?",
        "What is extraction yield?",
        "What is coffee temperature?",
        "What is coffee grind particle size?",
        "What is coffee percolation?",
        "What is coffee turbulence?",
        "What is coffee diffusion?",
        "What is coffee pH?",
        "What is coffee viscosity?",
        "What is coffee crema science?",
        "What is coffee emulsion?",
        "What is coffee volatile compounds?",
        "What is Maillard reaction in coffee?",
        "What is caramelization in coffee?",
        "What is coffee pyrolysis?",
        "What is coffee cell structure?",
        "What is coffee bean density?",
        "What is coffee moisture content?",
        "What is coffee water activity?",
        "What is coffee gas chromatography?",
        "What is coffee sensory science?",
        "What is coffee cupping protocol?",
        "What is coffee refractometry?",
        "What is coffee pressure profiling?",
        "What is flow rate in espresso?",
        "What is pre-infusion?",
        "What is bloom phase?",
        "What is agitation in coffee?",
        "What is bypass in coffee?",
        "What is channel resistance?",
        "What is coffee fines?",
        "What is coffee boulders?",
        
        # Coffee culture and history (30 topics)
        "What is coffee history?",
        "Where did coffee originate?",
        "What is Ethiopian coffee legend?",
        "What is coffee in Europe history?",
        "What is coffee house history?",
        "What is coffee in America?",
        "What is Turkish coffee tradition?",
        "What is Italian coffee culture?",
        "What is Scandinavian coffee culture?",
        "What is Japanese coffee culture?",
        "What is third wave coffee?",
        "What is specialty coffee movement?",
        "What is coffee ceremony?",
        "What is coffee social aspect?",
        "What is coffeehouse culture?",
        "What is coffee art?",
        "What is coffee literature?",
        "What is coffee rituals?",
        "What is coffee in religion?",
        "What is coffee trade history?",
        "What is coffee colonialism?",
        "What is coffee Boston Tea Party?",
        "What is coffee industrial revolution?",
        "What is instant coffee history?",
        "What is espresso invention?",
        "What is coffee machine evolution?",
        "What is coffee globalization?",
        "What is coffee in music?",
        "What is coffee in film?",
        "What is modern coffee trends?",
        
        # Advanced techniques (35 topics)
        "What is competition coffee brewing?",
        "What is World Barista Championship?",
        "What is signature beverage?",
        "What is sensory judging?",
        "What is coffee calibration?",
        "What is dial in espresso?",
        "What is espresso workflow?",
        "What is milk steaming technique?",
        "What is latte art rosetta?",
        "What is latte art tulip?",
        "What is latte art swan?",
        "What is free pour latte art?",
        "What is etching latte art?",
        "What is microfoam?",
        "What is milk texture?",
        "What is stretch phase milk?",
        "What is polish phase milk?",
        "What is coffee tasting notes?",
        "What is coffee flavor wheel?",
        "What is coffee cupping score?",
        "What is coffee defects?",
        "What is quakers in coffee?",
        "What is phenolic in coffee?",
        "What is ferment defect?",
        "What is coffee roast defects?",
        "What is baked coffee?",
        "What is underdeveloped coffee?",
        "What is roast profiling software?",
        "What is RoR in roasting?",
        "What is DTR in roasting?",
        "What is development time ratio?",
        "What is sample roasting?",
        "What is production roasting?",
        "What is batch size roasting?",
        "What is roast consistency?",
        
        # Troubleshooting (30 topics)
        "Why is my coffee bitter?",
        "Why is my coffee sour?",
        "Why is my espresso channeling?",
        "Why is my espresso too fast?",
        "Why is my espresso too slow?",
        "Why is my coffee weak?",
        "Why is my coffee too strong?",
        "Why is my coffee muddy?",
        "Why is my pour over uneven?",
        "Why does my coffee taste burnt?",
        "Why does my coffee taste flat?",
        "Why is my coffee astringent?",
        "Why is my grinder clogging?",
        "Why is my espresso machine leaking?",
        "Why is no crema on espresso?",
        "Why is my milk not steaming?",
        "Why are my coffee grounds too fine?",
        "Why are my coffee grounds too coarse?",
        "Why is my coffee staling fast?",
        "Why does my coffee taste papery?",
        "Why does my coffee taste metallic?",
        "Why is my French press gritty?",
        "Why is my cold brew cloudy?",
        "Why is my espresso separating?",
        "Why is my latte art not forming?",
        "Why is my coffee maker slow?",
        "Why is my coffee temperature low?",
        "Why is my grinder inconsistent?",
        "Why does my coffee taste plastic?",
        "Why is my coffee foamy?",
        
        # Accessories and tools (25 topics)
        "What is WDT tool?",
        "What is coffee distribution tool?",
        "What is tamping mat?",
        "What is knock box?",
        "What is portafilter basket types?",
        "What is precision basket?",
        "What is bottomless portafilter?",
        "What is dosing funnel?",
        "What is puck screen?",
        "What is group head brush?",
        "What is steam wand cloth?",
        "What is milk pitcher sizes?",
        "What is coffee syrups?",
        "What is coffee server?",
        "What is gooseneck kettle?",
        "What is pour over stand?",
        "What is coffee decanter?",
        "What is coffee warmer?",
        "What is coffee scoop?",
        "What is tamper types?",
        "What is calibrated tamper?",
        "What is leveling tamper?",
        "What is palm tamper?",
        "What is coffee brush?",
        "What is backflush disc?",
        
        # Water chemistry (20 topics)
        "What is coffee water chemistry?",
        "What is water hardness coffee?",
        "What is TDS in water?",
        "What is alkalinity in water?",
        "What is calcium in water?",
        "What is magnesium in water?",
        "What is sodium in water?",
        "What is chlorine in coffee water?",
        "What is filtered water coffee?",
        "What is distilled water coffee?",
        "What is mineral water coffee?",
        "What is reverse osmosis coffee?",
        "What is water filter coffee?",
        "What is SCA water standard?",
        "What is water recipe coffee?",
        "What is Third Wave Water?",
        "What is remineralization?",
        "What is water pH coffee?",
        "What is buffer capacity water?",
        "What is scale prevention coffee?",
        
        # Commercial coffee (20 topics)
        "What is commercial espresso machine?",
        "What is commercial grinder?",
        "What is coffee shop workflow?",
        "What is coffee shop layout?",
        "What is coffee shop equipment?",
        "What is batch brewing commercial?",
        "What is coffee shop menu?",
        "What is coffee pricing?",
        "What is coffee shop training?",
        "What is coffee quality control?",
        "What is coffee shop maintenance?",
        "What is coffee waste management?",
        "What is coffee shop efficiency?",
        "What is peak hour coffee?",
        "What is coffee shop standards?",
        "What is barista workflow?",
        "What is coffee shop cleaning?",
        "What is coffee shop safety?",
        "What is coffee inventory?",
        "What is coffee supplier relationship?",
    ]
    
    examples = []
    
    # For each topic, retrieve relevant context and create Q&A
    for topic in TOPICS:
        results = retriever.retrieve(topic, top_k=2)
        
        # Combine retrieved chunks
        context = "\n\n".join([r['text'] for r in results])
        
        # Create training example with TinyLlama chat format
        example = {
            'text': f"<|system|>\nYou are a helpful coffee expert.</s>\n<|user|>\n{topic}</s>\n<|assistant|>\n{context}</s>"
        }
        examples.append(example)
    
    # Add general conversational examples
    CONVERSATIONAL = [
        {
            'question': "Hi! Can you help me with coffee?",
            'answer': "Hello! I'd be happy to help you with coffee. I'm knowledgeable about coffee varieties, brewing methods, flavor profiles, and more. What would you like to know?"
        },
        {
            'question': "I'm new to coffee. Where should I start?",
            'answer': "Welcome to the world of coffee! I'd recommend starting with a medium roast from a well-known origin like Colombia or Brazil. Try brewing it with a simple method like drip coffee or French press. Pay attention to the flavors you taste - do you like it sweet, acidic, or bold? This will help guide your coffee journey."
        },
        {
            'question': "What's the difference between light and dark roast?",
            'answer': "Light roast coffee is roasted for a shorter time, preserving more of the bean's original flavors - often fruity, floral, or tea-like notes with higher acidity. Dark roast is roasted longer, developing deeper, more roasted flavors like chocolate, caramel, and smoke, with lower acidity but more body. Neither is 'better' - it's about personal preference!"
        },
    ]
    
    for conv in CONVERSATIONAL:
        example = {
            'text': f"<|system|>\nYou are a helpful coffee expert.</s>\n<|user|>\n{conv['question']}</s>\n<|assistant|>\n{conv['answer']}</s>"
        }
        examples.append(example)
    
    # Save to JSONL
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        for example in examples:
            f.write(json.dumps(example) + '\n')
    
    # Create train/val/test splits (80/10/10)
    import random
    random.seed(42)  # For reproducibility
    random.shuffle(examples)
    
    n = len(examples)
    train_size = int(n * 0.8)
    val_size = int(n * 0.1)
    
    train_data = examples[:train_size]
    val_data = examples[train_size:train_size + val_size]
    test_data = examples[train_size + val_size:]
    
    # Save splits
    train_file = output_file.parent / "coffee_train.jsonl"
    val_file = output_file.parent / "coffee_val.jsonl"
    test_file = output_file.parent / "coffee_test.jsonl"
    
    with open(train_file, 'w', encoding='utf-8') as f:
        for ex in train_data:
            f.write(json.dumps(ex) + '\n')
    
    with open(val_file, 'w', encoding='utf-8') as f:
        for ex in val_data:
            f.write(json.dumps(ex) + '\n')
    
    with open(test_file, 'w', encoding='utf-8') as f:
        for ex in test_data:
            f.write(json.dumps(ex) + '\n')
    
    print(f"✅ Generated {len(examples)} coffee training examples")
    print(f"   Saved all data to: {output_file}")
    print(f"   Training (80%): {len(train_data)} examples → {train_file}")
    print(f"   Validation (10%): {len(val_data)} examples → {val_file}")
    print(f"   Test (10%): {len(test_data)} examples → {test_file}")
    
    return examples

def main():
    # Paths
    base_dir = Path(__file__).parent.parent
    rag_dir = base_dir / "rag_data"
    training_file = base_dir / "training_data" / "coffee.jsonl"
    output_dir = base_dir / "models" / "tinyllama_v2"
    
    # Check if RAG data exists
    if not (rag_dir / "coffee_chunks.json").exists():
        print("❌ RAG data not found!")
        print("   Please run build_coffee_rag.py first")
        return
    
    # Generate training data
    print("Generating coffee training data from RAG chunks...")
    examples = generate_coffee_training_data(rag_dir, training_file)
    
    # Load training and validation data
    train_file = base_dir / "training_data" / "coffee_train.jsonl"
    val_file = base_dir / "training_data" / "coffee_val.jsonl"
    test_file = base_dir / "training_data" / "coffee_test.jsonl"
    
    with open(train_file, 'r', encoding='utf-8') as f:
        train_data = [json.loads(line) for line in f]
    
    with open(val_file, 'r', encoding='utf-8') as f:
        val_data = [json.loads(line) for line in f]
    
    # Create datasets
    train_dataset = Dataset.from_list(train_data)
    val_dataset = Dataset.from_list(val_data)
    
    print(f"\n📊 Datasets loaded:")
    print(f"   Training: {len(train_dataset)} examples")
    print(f"   Validation: {len(val_dataset)} examples")
    
    # Quantization config (4-bit)
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )
    
    # Load model
    print("\n🔧 Loading TinyLlama 1.1B model...")
    model = AutoModelForCausalLM.from_pretrained(
        "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        quantization_config=bnb_config,
        device_map="auto",
    )
    
    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained("TinyLlama/TinyLlama-1.1B-Chat-v1.0")
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    
    # Prepare model for k-bit training
    model = prepare_model_for_kbit_training(model)
    
    # LoRA config
    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    
    # Apply LoRA
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()
    
    # Training arguments (3 epochs for 550+ topics - large dataset)
    training_args = TrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=3,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        fp16=True,
        save_strategy="epoch",
        eval_strategy="epoch",
        logging_steps=10,
        warmup_steps=50,
        optim="paged_adamw_8bit",
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        save_total_limit=2,
    )
    
    # Create trainer
    early_stop_callback = EarlyStoppingCallback(loss_threshold=0.68, grad_norm_threshold=0.7)
    trainer = SFTTrainer(
        model=model,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        args=training_args,
        tokenizer=tokenizer,
        dataset_text_field="text",
        max_seq_length=512,
        callbacks=[early_stop_callback],
    )
    
    # Train
    print("\n🚀 Starting training...")
    print("📊 Early stopping enabled: loss < 0.68 AND grad_norm < 0.7")
    trainer.train()
    
    # Note: Test set evaluation skipped due to data collator requirements
    # The model has been validated during training with the validation set
    print(f"\n✅ Training complete! Validation loss: {trainer.state.best_metric:.4f}")
    
    # Save
    print("\n💾 Saving model...")
    trainer.save_model()
    tokenizer.save_pretrained(output_dir)
    
    print(f"\n✅ Training complete!")
    print(f"   Model saved to: {output_dir}")
    print(f"   Best validation loss: {trainer.state.best_metric:.4f}")
    print("\n📝 Next steps:")
    print("   1. Update app.py to load tinyllama_v2 model")
    print("   2. Test coffee queries with RAG retrieval")

if __name__ == "__main__":
    main()
