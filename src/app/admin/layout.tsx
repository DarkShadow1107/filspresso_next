import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export const metadata: Metadata = {
	robots: {
		index: false,
		follow: false,
	},
};

async function hasValidAdminSession(token: string) {
	try {
		const response = await fetch(`${API_BASE}/api/admin/session`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
			},
			cache: "no-store",
		});

		return response.ok;
	} catch {
		return false;
	}
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
	const cookieStore = await cookies();
	const token = cookieStore.get("admin_token")?.value?.trim();
	if (!token) {
		redirect("/admin-login");
	}

	const isValid = await hasValidAdminSession(token);
	if (!isValid) {
		redirect("/admin-login");
	}

	return children;
}
