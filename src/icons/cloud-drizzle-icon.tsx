import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const CloudDrizzleIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
	({ size = 24, color = "currentColor", strokeWidth = 2, className = "" }, ref) => {
		const [scope, animate] = useAnimate();

		const start = useCallback(() => {
			animate(".cloud", { y: [0, -1, 0] }, { duration: 3, repeat: Infinity, ease: "easeInOut" });
			animate(".drizzle-1", { y: [0, 2, 0] }, { duration: 1.5, repeat: Infinity, ease: "easeInOut" });
			animate(".drizzle-2", { y: [0, 2, 0] }, { duration: 1.5, delay: 0.5, repeat: Infinity, ease: "easeInOut" });
			animate(".drizzle-3", { y: [0, 2, 0] }, { duration: 1.5, delay: 0.2, repeat: Infinity, ease: "easeInOut" });
		}, [animate]);

		const stop = useCallback(() => {
			animate(".cloud", { y: 0 }, { duration: 0.2 });
			animate(".drizzle-1", { y: 0 }, { duration: 0.2 });
			animate(".drizzle-2", { y: 0 }, { duration: 0.2 });
			animate(".drizzle-3", { y: 0 }, { duration: 0.2 });
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
				<path className="drizzle-1" d="M8 19v2" />
				<path className="drizzle-2" d="M8 13v2" />
				<path className="drizzle-3" d="M16 19v2" />
				<path className="drizzle-1" d="M16 13v2" />
				<path className="drizzle-2" d="M12 21v2" />
				<path className="drizzle-3" d="M12 15v2" />
			</motion.svg>
		);
	},
);

CloudDrizzleIcon.displayName = "CloudDrizzleIcon";
export default CloudDrizzleIcon;
