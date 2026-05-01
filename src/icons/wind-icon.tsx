import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const WindIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
	({ size = 24, color = "currentColor", strokeWidth = 2, className = "" }, ref) => {
		const [scope, animate] = useAnimate();

		const start = useCallback(() => {
			animate(".wind-1", { x: [0, 4, 0] }, { duration: 1.8, repeat: Infinity, ease: "easeInOut" });
			animate(".wind-2", { x: [0, 6, 0] }, { duration: 2.2, repeat: Infinity, ease: "easeInOut" });
			animate(".wind-3", { x: [0, 5, 0] }, { duration: 2, repeat: Infinity, ease: "easeInOut" });
		}, [animate]);

		const stop = useCallback(() => {
			animate(".wind-1", { x: 0 }, { duration: 0.2 });
			animate(".wind-2", { x: 0 }, { duration: 0.2 });
			animate(".wind-3", { x: 0 }, { duration: 0.2 });
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
				<path className="wind-1" d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
				<path className="wind-2" d="M9.6 4.6A2 2 0 1 1 11 8H2" />
				<path className="wind-3" d="M12.6 19.4A2 2 0 1 0 14 16H2" />
			</motion.svg>
		);
	},
);

WindIcon.displayName = "WindIcon";
export default WindIcon;
