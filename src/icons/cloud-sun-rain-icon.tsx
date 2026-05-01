import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const CloudSunRainIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
	({ size = 24, color = "currentColor", strokeWidth = 2, className = "" }, ref) => {
		const [scope, animate] = useAnimate();

		const start = useCallback(() => {
			animate(".cloud", { x: [0, 2, 0] }, { duration: 3.5, repeat: Infinity, ease: "easeInOut" });
			animate(".sun", { rotate: 360 }, { duration: 15, repeat: Infinity, ease: "linear" });
			animate(".rain-1", { y: [0, 2, 0] }, { duration: 1.5, repeat: Infinity, ease: "easeInOut" });
			animate(".rain-2", { y: [0, 2, 0] }, { duration: 1.5, delay: 0.5, repeat: Infinity, ease: "easeInOut" });
		}, [animate]);

		const stop = useCallback(() => {
			animate(".cloud", { x: 0 }, { duration: 0.2 });
			animate(".sun", { rotate: 0 }, { duration: 0.2 });
			animate(".rain-1", { y: 0 }, { duration: 0.2 });
			animate(".rain-2", { y: 0 }, { duration: 0.2 });
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
				<g className="sun" style={{ transformOrigin: "12px 12px" }}>
					<path d="M12 2v2" />
					<path d="m4.93 4.93 1.41 1.41" />
					<path d="M20 12h2" />
					<path d="m19.07 4.93-1.41 1.41" />
					<path d="M15.947 8.653A5 5 0 0 0 12 4 5 5 0 0 0 7.4 10.45" />
				</g>
				<path className="rain-1" d="M11 20v2" />
				<path className="rain-2" d="M7 19v2" />
			</motion.svg>
		);
	},
);

CloudSunRainIcon.displayName = "CloudSunRainIcon";
export default CloudSunRainIcon;
