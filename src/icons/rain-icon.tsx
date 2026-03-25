import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const RainIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
	({ size = 24, color = "currentColor", strokeWidth = 2, className = "" }, ref) => {
		const [scope, animate] = useAnimate();

		const start = useCallback(() => {
			animate(".drop", { y: [0, 4, 0], opacity: [0, 1, 0] }, { duration: 1, repeat: Infinity, ease: "linear" });
		}, [animate]);

		const stop = useCallback(() => {
			animate(".drop", { y: 0, opacity: 1 }, { duration: 0.2 });
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
				<path d="M8 13v2" className="drop" />
				<path d="M12 15v2" className="drop" style={{ animationDelay: "0.2s" }} />
				<path d="M16 13v2" className="drop" style={{ animationDelay: "0.4s" }} />
			</motion.svg>
		);
	},
);

RainIcon.displayName = "RainIcon";
export default RainIcon;
