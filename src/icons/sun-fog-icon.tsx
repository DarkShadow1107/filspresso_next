import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const SunFogIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
	({ size = 24, color = "currentColor", strokeWidth = 2, className = "" }, ref) => {
		const [scope, animate] = useAnimate();

		const start = useCallback(() => {
			animate(".sun", { rotate: 360 }, { duration: 15, repeat: Infinity, ease: "linear" });
			animate(".fog-1", { x: [0, 2, 0] }, { duration: 4, repeat: Infinity, ease: "easeInOut" });
			animate(".fog-2", { x: [0, -2, 0] }, { duration: 4.5, repeat: Infinity, ease: "easeInOut" });
		}, [animate]);

		const stop = useCallback(() => {
			animate(".sun", { rotate: 0 }, { duration: 0.2 });
			animate(".fog-1", { x: 0 }, { duration: 0.2 });
			animate(".fog-2", { x: 0 }, { duration: 0.2 });
		}, [animate]);

		useImperativeHandle(ref, () => ({
			startAnimation: start,
			stopAnimation: stop,
		}));

		return (
			<motion.svg
				ref={scope}
				xmlns="http://www.w3.org/2000/svg"
				width={size}
				height={size}
				viewBox="0 0 24 24"
				fill="none"
				stroke={color}
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
				className={className}
				onHoverStart={start}
				onHoverEnd={stop}
			>
				<g className="sun" style={{ transformOrigin: "12px 8px" }}>
					<circle cx="12" cy="8" r="4" />
					<path d="M12 2v2" />
					<path d="M12 12v2" />
					<path d="m4.93 4.93 1.41 1.41" />
					<path d="m17.66 7.66 1.41 1.41" />
					<path d="M2 8h2" />
					<path d="M20 8h2" />
					<path d="m6.34 11.66-1.41 1.41" />
					<path d="m19.07 2.93-1.41 1.41" />
				</g>
				<path className="fog-1" d="M4 16h16" />
				<path className="fog-2" d="M4 20h16" />
			</motion.svg>
		);
	},
);

SunFogIcon.displayName = "SunFogIcon";
export default SunFogIcon;
