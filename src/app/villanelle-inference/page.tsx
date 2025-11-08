import dynamic from "next/dynamic";
import React from "react";

const VillanelleClient = dynamic(() => import("./VillanelleClient"), { ssr: false });

export default function Page() {
	return (
		<main style={{ padding: 24 }}>
			<h1>Villanelle — On-device Inference</h1>
			<p>
				This page loads the Gemma task file from the server API and runs inference in the browser using MediaPipe Tasks
				GenAI. WebGPU is required.
			</p>
			<VillanelleClient />
		</main>
	);
}
