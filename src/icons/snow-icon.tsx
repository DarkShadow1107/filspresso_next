import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const SnowIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
	({ size = 24, color = "currentColor", strokeWidth = 2, className = "" }, ref) => {
		const [scope, animate] = useAnimate();

		const start = useCallback(() => {
			animate(".flake", { rotate: 360, y: [0, 2, 0] }, { duration: 3, repeat: Infinity, ease: "linear" });
		}, [animate]);

		const stop = useCallback(() => {
			animate(".flake", { rotate: 0, y: 0 }, { duration: 0.2 });
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
				<path d="M17.5 19c2.5 0 4.5-2 4.5-4.5 0-2.3-1.7-4.1-3.9-4.4C17.6 6.1 14.1 3 10 3 6.4 3 3.5 5.4 3.1 8.6 1.3 9.4 0 11.3 0 13.5 0 16.5 2.5 19 5.5 19" />
				<path d="m8 15 .01 0" className="flake" />
				<path d="m12 17 .01 0" className="flake" />
				<path d="m16 15 .01 0" className="flake" />
			</motion.svg>
		);
	},
);

SnowIcon.displayName = "SnowIcon";
export default SnowIcon;
