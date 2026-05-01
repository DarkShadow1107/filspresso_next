import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const CloudMoonIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
	({ size = 24, color = "currentColor", strokeWidth = 2, className = "" }, ref) => {
		const [scope, animate] = useAnimate();

		const start = useCallback(() => {
			animate(".cloud", { x: [0, 2, 0] }, { duration: 4, repeat: Infinity, ease: "easeInOut" });
			animate(".moon", { rotate: [0, -3, 0], scale: [1, 1.05, 1] }, { duration: 5, repeat: Infinity, ease: "easeInOut" });
		}, [animate]);

		const stop = useCallback(() => {
			animate(".cloud", { x: 0 }, { duration: 0.2 });
			animate(".moon", { rotate: 0, scale: 1 }, { duration: 0.2 });
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
				<path className="cloud" d="M13 16a3 3 0 1 1 0 6H7a5 5 0 1 1 4.9-6Z" />
				<path className="moon" d="M10.1 9A6 6 0 0 1 16 4a4.24 4.24 0 0 0 6 6 6 6 0 0 1-3 5.197" style={{ transformOrigin: "15px 9px" }} />
			</motion.svg>
		);
	},
);

CloudMoonIcon.displayName = "CloudMoonIcon";
export default CloudMoonIcon;
