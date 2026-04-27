"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useNotifications } from "./NotificationsProvider";
import { readAccountSession } from "@/lib/accountSession";

const API_BASE = (typeof window === "undefined" ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000" : "") + "/api";

export type FavoriteItem = {
	product_type: "capsule" | "machine";
	product_id: string;
	product_category?: string;
};

interface FavoritesContextType {
	favorites: FavoriteItem[];
	isFavorite: (type: "capsule" | "machine", id: string) => boolean;
	toggleFavorite: (type: "capsule" | "machine", id: string, category: string) => Promise<void>;
	syncFavorites: () => Promise<void>;
	refreshFavorites: () => Promise<void>;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

function getAuthToken(): string | null {
	if (typeof window === "undefined") return null;
	return readAccountSession()?.token || null;
}

export const FavoritesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
	const { notify } = useNotifications();
	const initialSyncDone = useRef(false);

	const fetchFavorites = useCallback(async () => {
		const token = getAuthToken();
		if (!token) {
			// Guest: Load from localStorage
			const local = localStorage.getItem("filspresso_favorites");
			if (local) {
				try {
					setFavorites(JSON.parse(local));
				} catch (e) {
					console.error("Failed to parse local favorites", e);
				}
			}
			return;
		}

		try {
			const res = await fetch(`${API_BASE}/favorites`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				setFavorites(data.favorites || []);
			}
		} catch (error) {
			console.warn("Favorites API unavailable. Using local favorites cache.");
		}
	}, []);

	const syncFavorites = useCallback(async () => {
		const token = getAuthToken();
		if (!token) return;

		const local = localStorage.getItem("filspresso_favorites");
		if (!local) {
			fetchFavorites();
			return;
		}

		try {
			const localFavs = JSON.parse(local) as FavoriteItem[];
			if (localFavs.length > 0) {
				const res = await fetch(`${API_BASE}/favorites/sync`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ favorites: localFavs }),
					keepalive: true,
				});

				if (res.ok) {
					localStorage.removeItem("filspresso_favorites");
					notify("Your local favorites have been saved to your account!", 5000, "success");
				}
			}
			fetchFavorites();
		} catch (error) {
			console.error("Sync favorites error", error);
			fetchFavorites();
		}
	}, [fetchFavorites]);

	useEffect(() => {
		// Initial fetch
		fetchFavorites();

		// Check if we need to sync guest favorites on mount (e.g. if user was already logged in)
		const token = getAuthToken();
		const local = localStorage.getItem("filspresso_favorites");
		if (token && local) {
			syncFavorites();
		}

		const handleSessionUpdate = () => {
			syncFavorites();
		};

		window.addEventListener("session-update", handleSessionUpdate);
		return () => window.removeEventListener("session-update", handleSessionUpdate);
	}, [fetchFavorites, syncFavorites]);

	const isFavorite = useCallback(
		(type: "capsule" | "machine", id: string) => {
			return favorites.some((f) => f.product_type === type && f.product_id === id);
		},
		[favorites],
	);

	const toggleFavorite = useCallback(
		async (type: "capsule" | "machine", id: string, category: string) => {
			const token = getAuthToken();
			const alreadyFavorite = isFavorite(type, id);

			let newFavs: FavoriteItem[];
			if (alreadyFavorite) {
				newFavs = favorites.filter((f) => !(f.product_type === type && f.product_id === id));
			} else {
				newFavs = [...favorites, { product_type: type, product_id: id, product_category: category }];
			}

			// Optimistic UI update
			setFavorites(newFavs);

			if (!token) {
				// Guest: Update localStorage
				localStorage.setItem("filspresso_favorites", JSON.stringify(newFavs));
				notify(alreadyFavorite ? "Removed from favorites" : "Added to favorites", 3000, "info");
			} else {
				// Authenticated: Sync with API
				try {
					if (alreadyFavorite) {
						await fetch(`${API_BASE}/favorites/${type}/${id}`, {
							method: "DELETE",
							headers: { Authorization: `Bearer ${token}` },
							keepalive: true,
						});
					} else {
						await fetch(`${API_BASE}/favorites`, {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${token}`,
							},
							body: JSON.stringify({ product_type: type, product_id: id, product_category: category }),
							keepalive: true,
						});
					}
					notify(alreadyFavorite ? "Removed from favorites" : "Added to favorites", 3000, "success");
				} catch (error) {
					console.error("Toggle favorite failed", error);
					// Revert optimistic update
					fetchFavorites();
					notify("Failed to update favorites", 3000, "error");
				}
			}
		},
		[favorites, isFavorite, notify, fetchFavorites],
	);

	return (
		<FavoritesContext.Provider
			value={{ favorites, isFavorite, toggleFavorite, syncFavorites, refreshFavorites: fetchFavorites }}
		>
			{children}
		</FavoritesContext.Provider>
	);
};

export const useFavorites = () => {
	const context = useContext(FavoritesContext);
	if (!context) {
		throw new Error("useFavorites must be used within a FavoritesProvider");
	}
	return context;
};
