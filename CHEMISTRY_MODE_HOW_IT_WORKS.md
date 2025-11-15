# Chemistry Mode Control - How It Actually Works

## The Simple Truth

Your model is **trained on both coffee AND chemistry data**. It already knows about both.

The `chemistry_mode` flag **controls the system prompt** to tell the model what it should talk about:

```
Model (trained on coffee + chemistry): Knows everything ✓

chemistry_mode = false →
  System Prompt: "Only discuss coffee, don't mention chemistry"
  Result: Model focuses on coffee only in its output

chemistry_mode = true →
  System Prompt: "You can discuss both coffee and chemistry"
  Result: Model provides full expertise including molecular analysis
```

---

## How It Works in Your Code

### In `app.py`

When a user sends a message:

```python
# 1. User sends message with chemistry_mode flag
POST /api/chat
{
    "message": "What's in coffee that makes it taste good?",
    "chemistry_mode": false,
    "subscription": "ultimate"
}

# 2. App creates appropriate system prompt
system_prompt = create_system_prompt(chemistry_mode=false, model_name='tanka')
# Returns: "You are Kafelot... COFFEE-ONLY MODE: Keep discussion focused on coffee..."

# 3. System prompt is prepended to user message
full_message = f"{system_prompt}\n\nUser: {original_message}"

# 4. Model generates response respecting the instructions
# Output: "Coffee has hundreds of compounds... the main ones are..."
# (no molecular structures mentioned)
```

### Without Chemistry Mode

```
User: "Tell me about caffeine"

System Prompt says: "Do NOT discuss molecular structures, atoms, or chemical formulas"

Model Output: "Caffeine is a natural stimulant that gives coffee its energizing kick!"
(NOT: "Caffeine is a 1,3,7-trimethylxanthine with molecular formula C8H10N4O2...")
```

### With Chemistry Mode (Ultimate)

```
User: "Tell me about caffeine"

System Prompt says: "You can discuss molecular structures and chemical interactions"

Model Output: "Caffeine is an alkaloid compound (1,3,7-trimethylxanthine, C8H10N4O2)
that binds to adenosine receptors, blocking fatigue signals. Coffee contains 95-200mg
per cup depending on brewing method..."
```

---

## The Prompt Structure

### Coffee-Only Prompt

```
You are Kafelot, a friendly and knowledgeable coffee expert AI assistant.
Your main expertise and passion is coffee - its varieties, brewing methods, flavors, and culture.
Be warm, engaging, and share your enthusiasm for quality coffee.

COFFEE-ONLY MODE: Keep discussion focused on coffee expertise.
IMPORTANT RESTRICTIONS:
- Do NOT discuss molecular structures, atoms, or chemical formulas
- Do NOT mention "caffeine molecule" - say "caffeine" instead
- Do NOT explain chemistry
- If asked about molecules, politely redirect...

User: {user message}
```

### Chemistry-Enabled Prompt

```
You are Kafelot, a friendly and knowledgeable coffee expert AI assistant.
Your main expertise and passion is coffee - its varieties, brewing methods, flavors, and culture.
Be warm, engaging, and share your enthusiasm for quality coffee.

CHEMISTRY MODE ENABLED: You have access to advanced molecular and chemical knowledge.
When discussing coffee and the user shows interest in the science:
- You can discuss caffeine, chlorogenic acid, and other compounds
- You can explain the chemistry of brewing extraction
- You can reference molecular structures and chemical interactions
- Provide detailed scientific explanations when asked

User: {user message}
```

---

## The Flow Diagram

```
User Request
    ↓
Check chemistry_mode flag
    ├─→ false (default)
    │   ├─ Check subscription (not required)
    │   ├─ Create COFFEE-ONLY prompt
    │   └─ Send to model: "Only talk about coffee"
    │
    └─→ true (chemistry enabled)
        ├─ Check subscription == "ultimate" ?
        │   ├─ No → Return 403 error, ask to upgrade
        │   └─ Yes → Proceed
        ├─ Create CHEMISTRY-ENABLED prompt
        └─ Send to model: "You can discuss chemistry too"

Model receives (system prompt + user message)
    ↓
Generates response respecting the instructions
    ↓
Return response to user
```

---

## What Changed in Your Code

### Before

```python
@app.route('/api/chat', methods=['POST'])
def chat():
    # ... validation ...
    response = engine.chat(
        message=message,  # Just the user message
        # ...
    )
```

### After

```python
@app.route('/api/chat', methods=['POST'])
def chat():
    # ... validation ...

    # Create system prompt based on chemistry mode
    system_prompt = create_system_prompt(chemistry_mode, model_name)

    # Prepend to message
    full_message = f"{system_prompt}\n\nUser: {message}"

    response = engine.chat(
        message=full_message,  # System prompt + user message
        # ...
    )
```

---

## Why This Works

Modern language models are **highly responsive to instructions** in prompts. By telling them explicitly:

-   "Don't discuss X" → They won't mention X
-   "You can discuss Y" → They will provide Y when relevant
-   "Keep it simple" → They use simpler language

This is **much simpler** than trying to restrict the model's knowledge or create separate models.

---

## Testing It

```bash
# Coffee-only response
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is caffeine?",
    "chemistry_mode": false,
    "subscription": "ultimate",
    "model": "tanka"
  }'

# Chemistry-enabled response
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is caffeine?",
    "chemistry_mode": true,
    "subscription": "ultimate",
    "model": "tanka"
  }'
```

---

## Summary

✅ **Model is trained on everything** (coffee + chemistry)
✅ **System prompt controls output** (what to discuss)
✅ **Simple and effective** (no complex loading)
✅ **Already implemented** (in your app.py)
✅ **Production ready** (just use it!)

The model isn't restricted in knowledge - it's instructed in output! 🎯
