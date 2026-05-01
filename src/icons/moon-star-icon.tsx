import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const MoonStarIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
	({ size = 24, color = "currentColor", strokeWidth = 2, className = "" }, ref) => {
		const [scope, animate] = useAnimate();

		const start = useCallback(() => {
			animate(".star", { scale: [1, 1.25, 1], rotate: [0, 45, 0] }, { duration: 3, repeat: Infinity, ease: "easeInOut" });
			animate(".moon", { rotate: [0, -4, 0] }, { duration: 5, repeat: Infinity, ease: "easeInOut" });
		}, [animate]);

		const stop = useCallback(() => {
			animate(".star", { scale: 1, rotate: 0 }, { duration: 0.2 });
			animate(".moon", { rotate: 0 }, { duration: 0.2 });
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
				<path className="moon" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" style={{ transformOrigin: "12px 12px" }} />
				<g className="star" style={{ transformOrigin: "19px 5px" }}>
					<path d="M19 3v4" />
					<path d="M21 5h-4" />
				</g>
			</motion.svg>
		);
	},
);

MoonStarIcon.displayName = "MoonStarIcon";
export default MoonStarIcon;
