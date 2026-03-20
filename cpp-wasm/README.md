# C++ WebAssembly Build Module

This module compiles performance-sensitive helpers to WebAssembly.

Current focus is frontend acceleration for:

- QR and barcode scan pre-processing
- image preprocessing before AI calls
- vector scoring and ranking

## Output

Running the wasm builder container writes artifacts to:

- /public/wasm/filspresso_math.js
- /public/wasm/filspresso_math.wasm

## Build with Docker Compose

Use the wasm profile service:

```bash
docker compose run --rm wasm_builder
```

Then import the generated JS module in frontend code where high-volume math is needed.

## Exported native functions

- `filspresso_apply_subscription_discount(total, loyalty_level)`
- `filspresso_rank_score(aroma, body, acidity, sweetness)`
- `filspresso_preprocess_rgba_to_gray(rgba_ptr, pixel_count, out_gray_ptr)`
- `filspresso_binarize_gray(gray_ptr, pixel_count, threshold, out_binary_ptr)`
- `filspresso_vector_cosine(a_ptr, b_ptr, length)`
- `filspresso_qr_finder_score(binary_ptr, width, height)`

The QR function is a fast finder-pattern scorer for candidate filtering in browser scan flows.
Use it to reduce false positives and expensive decode attempts before a full decoder step.
