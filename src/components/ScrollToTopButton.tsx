import React, { useEffect, useState } from "react";
import { DownCheveron } from "@/icons";

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
		<a
			href="#top"
			className={`back-to-top${visible ? " visible" : ""}`}
			onClick={(e) => {
				e.preventDefault();
				scrollToTop();
			}}
			title="Top"
		>
			<DownCheveron size={28} strokeWidth={4} className="rotate-180" />
		</a>
	);
}
