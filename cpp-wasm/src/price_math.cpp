#include <emscripten/emscripten.h>
#include <cmath>
#include <cstdint>

extern "C" {

EMSCRIPTEN_KEEPALIVE
double filspresso_apply_subscription_discount(double total, int loyalty_level) {
    if (total < 0.0) {
        return 0.0;
    }

    double discount = 0.0;
    if (loyalty_level >= 5) {
        discount = 0.20;
    } else if (loyalty_level == 4) {
        discount = 0.18;
    } else if (loyalty_level == 3) {
        discount = 0.15;
    } else if (loyalty_level == 2) {
        discount = 0.10;
    } else if (loyalty_level == 1) {
        discount = 0.05;
    }

    return total - (total * discount);
}

EMSCRIPTEN_KEEPALIVE
double filspresso_rank_score(double aroma, double body, double acidity, double sweetness) {
    return (aroma * 0.35) + (body * 0.30) + (acidity * 0.20) + (sweetness * 0.15);
}

EMSCRIPTEN_KEEPALIVE
void filspresso_preprocess_rgba_to_gray(const uint8_t* rgba, int pixel_count, uint8_t* out_gray) {
    if (!rgba || !out_gray || pixel_count <= 0) {
        return;
    }

    for (int i = 0; i < pixel_count; ++i) {
        const int idx = i * 4;
        const double r = static_cast<double>(rgba[idx]);
        const double g = static_cast<double>(rgba[idx + 1]);
        const double b = static_cast<double>(rgba[idx + 2]);
        const double gray = (0.299 * r) + (0.587 * g) + (0.114 * b);
        out_gray[i] = static_cast<uint8_t>(gray);
    }
}

EMSCRIPTEN_KEEPALIVE
void filspresso_binarize_gray(const uint8_t* gray, int pixel_count, uint8_t threshold, uint8_t* out_binary) {
    if (!gray || !out_binary || pixel_count <= 0) {
        return;
    }

    for (int i = 0; i < pixel_count; ++i) {
        out_binary[i] = gray[i] >= threshold ? 255 : 0;
    }
}

EMSCRIPTEN_KEEPALIVE
double filspresso_vector_cosine(const float* a, const float* b, int length) {
    if (!a || !b || length <= 0) {
        return 0.0;
    }

    double dot = 0.0;
    double norm_a = 0.0;
    double norm_b = 0.0;

    for (int i = 0; i < length; ++i) {
        const double av = static_cast<double>(a[i]);
        const double bv = static_cast<double>(b[i]);
        dot += av * bv;
        norm_a += av * av;
        norm_b += bv * bv;
    }

    const double denom = std::sqrt(norm_a) * std::sqrt(norm_b);
    if (denom <= 0.0) {
        return 0.0;
    }

    return dot / denom;
}

EMSCRIPTEN_KEEPALIVE
int filspresso_qr_finder_score(const uint8_t* binary, int width, int height) {
    if (!binary || width < 7 || height < 1) {
        return 0;
    }

    int score = 0;
    for (int y = 0; y < height; ++y) {
        const int row_offset = y * width;
        for (int x = 0; x <= width - 7; ++x) {
            // Quick 1:1:3:1:1 style run check for QR finder-like row segments.
            const bool p0 = binary[row_offset + x] > 0;
            const bool p1 = binary[row_offset + x + 1] > 0;
            const bool p2 = binary[row_offset + x + 2] == 0;
            const bool p3 = binary[row_offset + x + 3] == 0;
            const bool p4 = binary[row_offset + x + 4] == 0;
            const bool p5 = binary[row_offset + x + 5] > 0;
            const bool p6 = binary[row_offset + x + 6] > 0;

            if (p0 && p1 && p2 && p3 && p4 && p5 && p6) {
                score += 1;
            }
        }
    }

    return score;
}

}
