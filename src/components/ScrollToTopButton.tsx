import React, { useEffect, useState } from "react";

export default function ScrollToTopButton() {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const onScroll = () => {
			setVisible(window.scrollY > 5);
		};
		window.addEventListener("scroll", onScroll);
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	const scrollToTop = () => {
		window.scrollTo({ top: 0, behavior: "smooth" });
	};

	return (
		<button className={`scroll-to-top-btn${visible ? " visible" : ""}`} onClick={scrollToTop} aria-label="Scroll to top">
			<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
				<circle cx="14" cy="14" r="13" stroke="#FECB89" strokeWidth="2" fill="rgba(18,16,18,0.96)" />
				<path
					d="M14 19V9M14 9L9 14M14 9L19 14"
					stroke="#FECB89"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</button>
	);
}
