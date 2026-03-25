FROM emscripten/emsdk:3.1.56
WORKDIR /workspace

COPY src ./src
RUN mkdir -p /artifacts && \
    emcc src/price_math.cpp \
      -O3 \
      -s WASM=1 \
      -s MODULARIZE=1 \
      -s EXPORT_ES6=1 \
      -s ENVIRONMENT=web \
  -s EXPORTED_FUNCTIONS='["_filspresso_apply_subscription_discount","_filspresso_rank_score","_filspresso_preprocess_rgba_to_gray","_filspresso_binarize_gray","_filspresso_vector_cosine","_filspresso_qr_finder_score","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
      -o /artifacts/filspresso_math.js

CMD ["/bin/sh", "-lc", "cp -f /artifacts/* /out/ && echo 'WASM artifacts copied to /out' && ls -la /out"]
