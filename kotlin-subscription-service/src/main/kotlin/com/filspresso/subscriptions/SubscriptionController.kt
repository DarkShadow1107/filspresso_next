package com.filspresso.subscriptions

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant

@RestController
@RequestMapping("/api/subscriptions")
class SubscriptionController {
    private val prices = mapOf(
        "free" to PricePlan(BigDecimal("0.00"), BigDecimal("0.00")),
        "basic" to PricePlan(BigDecimal("55.99"), BigDecimal("399.99")),
        "plus" to PricePlan(BigDecimal("109.99"), BigDecimal("1099.99")),
        "pro" to PricePlan(BigDecimal("169.99"), BigDecimal("1699.99")),
        "max" to PricePlan(BigDecimal("279.99"), BigDecimal("2699.99")),
        "ultimate" to PricePlan(BigDecimal("599.99"), BigDecimal("6299.99"))
    )

    @GetMapping("/health")
    fun health(): Map<String, Any> = mapOf(
        "status" to "ok",
        "service" to "kotlin-subscription-service",
        "time" to Instant.now().toString()
    )

    @PostMapping("/quote")
    fun quote(@RequestBody request: QuoteRequest): QuoteResponse {
        val tier = request.tier.lowercase()
        val billingCycle = request.billingCycle.lowercase()
        val plan = prices[tier] ?: error("Unsupported tier")
        val basePrice = if (billingCycle == "annual") plan.annual else plan.monthly

        val annualSavings = if (billingCycle == "annual" && tier != "free") {
            plan.monthly.multiply(BigDecimal("12.00")).subtract(plan.annual)
        } else {
            BigDecimal.ZERO
        }

        val loyaltyDiscountPct = when (request.currentTier.lowercase()) {
            "max", "ultimate" -> BigDecimal("5.00")
            "pro" -> BigDecimal("3.00")
            else -> BigDecimal.ZERO
        }

        val discountAmount = basePrice.multiply(loyaltyDiscountPct)
            .divide(BigDecimal("100.00"), 2, RoundingMode.HALF_UP)
        val finalPrice = basePrice.subtract(discountAmount).setScale(2, RoundingMode.HALF_UP)

        return QuoteResponse(
            tier = tier,
            billingCycle = billingCycle,
            currency = "RON",
            basePrice = basePrice.setScale(2, RoundingMode.HALF_UP),
            loyaltyDiscountPercent = loyaltyDiscountPct,
            loyaltyDiscountAmount = discountAmount,
            annualSavings = annualSavings.setScale(2, RoundingMode.HALF_UP),
            finalPrice = finalPrice,
            recommendation = if (billingCycle == "monthly" && tier != "free") {
                "Annual billing yields better value for this tier."
            } else {
                "Current billing cycle is optimal for flexibility."
            }
        )
    }

    @PostMapping("/reconcile")
    fun reconcile(@RequestBody request: ReconcileRequest): ReconcileResponse {
        val normalizedCurrent = request.currentTier.lowercase()
        val normalizedTarget = request.targetTier.lowercase()
        val result = when {
            normalizedCurrent == normalizedTarget -> "noop"
            normalizedCurrent == "free" -> "upgrade"
            normalizedTarget == "free" -> "downgrade"
            tierRank(normalizedTarget) > tierRank(normalizedCurrent) -> "upgrade"
            else -> "downgrade"
        }

        return ReconcileResponse(
            action = result,
            currentTier = normalizedCurrent,
            targetTier = normalizedTarget,
            effectiveAt = if (result == "upgrade") "immediate" else "next_renewal"
        )
    }

    private fun tierRank(tier: String): Int = when (tier) {
        "free" -> 0
        "basic" -> 1
        "plus" -> 2
        "pro" -> 3
        "max" -> 4
        "ultimate" -> 5
        else -> 0
    }
}

data class PricePlan(
    val monthly: BigDecimal,
    val annual: BigDecimal
)

data class QuoteRequest(
    val tier: String,
    val billingCycle: String,
    val currentTier: String = "free"
)

data class QuoteResponse(
    val tier: String,
    val billingCycle: String,
    val currency: String,
    val basePrice: BigDecimal,
    val loyaltyDiscountPercent: BigDecimal,
    val loyaltyDiscountAmount: BigDecimal,
    val annualSavings: BigDecimal,
    val finalPrice: BigDecimal,
    val recommendation: String
)

data class ReconcileRequest(
    val currentTier: String,
    val targetTier: String
)

data class ReconcileResponse(
    val action: String,
    val currentTier: String,
    val targetTier: String,
    val effectiveAt: String
)
