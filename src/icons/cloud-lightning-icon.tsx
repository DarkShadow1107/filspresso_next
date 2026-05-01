import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const CloudLightningIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
	({ size = 24, color = "currentColor", strokeWidth = 2, className = "" }, ref) => {
		const [scope, animate] = useAnimate();

		const start = useCallback(() => {
			animate(".cloud", { y: [0, -1, 0] }, { duration: 3, repeat: Infinity, ease: "easeInOut" });
			animate(".lightning", { opacity: [1, 0.2, 1, 0.2, 1] }, { duration: 1.5, repeat: Infinity, ease: "linear" });
		}, [animate]);

		const stop = useCallback(() => {
			animate(".cloud", { y: 0 }, { duration: 0.2 });
			animate(".lightning", { opacity: 1 }, { duration: 0.2 });
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
				<path className="cloud" d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" />
				<path className="lightning" d="m13 12-3 5h4l-3 5" />
			</motion.svg>
		);
	},
);

CloudLightningIcon.displayName = "CloudLightningIcon";
export default CloudLightningIcon;
