"use client";

import dynamic from "next/dynamic";

const CoffeeMachineScene = dynamic(() => import("./CoffeeMachineScene"), {
	ssr: false,
	loading: () => <div className="coffee-machine-legacy" aria-hidden="true" style={{ minHeight: "340px" }} />,
});

export default function CoffeeMachineSceneClient() {
	return <CoffeeMachineScene />;
}

