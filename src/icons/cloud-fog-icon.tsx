import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const CloudFogIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
	({ size = 24, color = "currentColor", strokeWidth = 2, className = "" }, ref) => {
		const [scope, animate] = useAnimate();

		const start = useCallback(() => {
			animate(".cloud", { y: [0, -1, 0] }, { duration: 3, repeat: Infinity, ease: "easeInOut" });
			animate(".fog-1", { x: [0, 2, 0] }, { duration: 4, repeat: Infinity, ease: "easeInOut" });
			animate(".fog-2", { x: [0, -2, 0] }, { duration: 4.5, repeat: Infinity, ease: "easeInOut" });
		}, [animate]);

		const stop = useCallback(() => {
			animate(".cloud", { y: 0 }, { duration: 0.2 });
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
				<path className="cloud" d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
				<path className="fog-1" d="M16 17H7" />
				<path className="fog-2" d="M17 21H9" />
			</motion.svg>
		);
	},
);

CloudFogIcon.displayName = "CloudFogIcon";
export default CloudFogIcon;
