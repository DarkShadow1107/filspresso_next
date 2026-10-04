import { forwardRef, useImperativeHandle, useCallback, useRef } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

/**
 * Liquid AI mark.
 *
 * Path data is the official Liquid AI logomark (via Lobe Icons, MIT licensed) —
 * three angular facets around an upward-pointing drop. It is the vendor mark for
 * the LFM2 / LFM2-VL models this project serves, so it replaces BrandQwenIcon,
 * which was only ever standing in for LFM.
 *
 * The animation follows the brand's own idea, that even what naturally flows
 * downward can rise when driven by purpose: on hover the three facets lift and
 * brighten bottom-first, so the mark reads as rising rather than wobbling.
 */
const BrandLiquidIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  ({ size = 24, color = "currentColor", className = "" }, ref) => {
    const [scope, animate] = useAnimate();
    const primary = useRef<SVGPathElement>(null);
    const secondary = useRef<SVGPathElement>(null);
    const accent = useRef<SVGPathElement>(null);

    const start = useCallback(() => {
      // Bottom-first delay: the mark assembles upward.
      animate(
        [primary.current, secondary.current, accent.current],
        { opacity: [0.3, 1], y: [3, 0] },
        { duration: 0.45, delay: (i: number) => i * 0.06, ease: "easeOut" },
      );
      animate(
        scope.current,
        { scale: [1, 1.08, 1] },
        { duration: 0.5, ease: "easeInOut" },
      );
    }, [animate, scope]);

    const stop = useCallback(() => {
      animate(
        [primary.current, secondary.current, accent.current],
        { opacity: 1, y: 0 },
        { duration: 0.2, ease: "easeOut" },
      );
      animate(
        scope.current,
        { scale: 1 },
        { duration: 0.2, ease: "easeOut" },
      );
    }, [animate, scope]);

    useImperativeHandle(
      ref,
      () => ({
        startAnimation: start,
        stopAnimation: stop,
      }),
      [start, stop],
    );

    return (
      <motion.svg
        ref={scope}
        onHoverStart={start}
        onHoverEnd={stop}
        fill={color}
        fillRule="evenodd"
        viewBox="0 0 24 24"
        height={size}
        width={size}
        style={{ flex: "none", lineHeight: 1 }}
        xmlns="http://www.w3.org/2000/svg"
        className={`liquid-icon cursor-pointer ${className}`}
      >
        <title>Liquid AI</title>

        <motion.path
          ref={primary}
          className="liquid-facet liquid-facet-primary"
          d="M12.028 8.546l-.008.005 3.03 5.25a3.94 3.94 0 01.643 2.162c0 .754-.212 1.46-.58 2.062l6.173-1.991L11.63 0 9.304 3.872l2.724 4.674z"
        />
        <motion.path
          ref={secondary}
          className="liquid-facet liquid-facet-secondary"
          d="M6.837 24l4.85-4.053h-.013c-2.219 0-4.017-1.784-4.017-3.984 0-.794.235-1.534.64-2.156l2.865-4.976-2.381-4.087L2 16.034 6.83 24h.007z"
        />
        <motion.path
          ref={accent}
          className="liquid-facet liquid-facet-accent"
          d="M13.737 19.382h-.001L8.222 24h8.182l4.148-6.769-6.815 2.151z"
        />
      </motion.svg>
    );
  },
);

BrandLiquidIcon.displayName = "BrandLiquidIcon";
export default BrandLiquidIcon;
