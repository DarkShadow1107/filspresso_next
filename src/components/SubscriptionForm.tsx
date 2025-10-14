"use client";

import { useState } from "react";

export default function SubscriptionForm() {
	const [status, setStatus] = useState<string | null>(null);

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const data = new FormData(e.currentTarget);
		const body = Object.fromEntries(data.entries());
		try {
			const res = await fetch("/api/subscribe", {
				method: "POST",
				body: JSON.stringify(body),
				headers: { "content-type": "application/json" },
			});
			const json = await res.json();
			setStatus(json.message || "ok");
		} catch {
			setStatus("error");
		}
	}

	return (
		<div>
			<h1 className="text-2xl font-bold mb-4">Subscription</h1>
			<form onSubmit={handleSubmit} className="max-w-md">
				<label className="block mb-2">
					<span className="text-sm">Email</span>
					<input name="email" required className="mt-1 block w-full border rounded px-3 py-2" />
				</label>
				<button className="mt-3 px-4 py-2 bg-emerald-600 text-white rounded">Subscribe</button>
			</form>
			{status && <p className="mt-4">Status: {status}</p>}
		</div>
	);
}
