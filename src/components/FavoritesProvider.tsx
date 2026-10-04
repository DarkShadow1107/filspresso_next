"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useNotifications } from "./NotificationsProvider";
import { fetchCurrentAccount } from "@/lib/clientAuth";

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

export const FavoritesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
	// The session lives in an httpOnly cookie, so sign-in state is resolved from
	// the server rather than read out of browser storage.
	const [signedIn, setSignedIn] = useState(false);
	const { notify } = useNotifications();

	const fetchFavorites = useCallback(async () => {
		if (!signedIn) {
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
			const res = await fetch(`${API_BASE}/favorites`, { credentials: "same-origin" });
			if (res.ok) {
				const data = await res.json();
				setFavorites(data.favorites || []);
			}
		} catch {
			console.warn("Favorites API unavailable. Using local favorites cache.");
		}
	}, [signedIn]);

	const syncFavorites = useCallback(async () => {
		if (!signedIn) return;

		const local = localStorage.getItem("filspresso_favorites");
		if (!local) {
			await fetchFavorites();
			return;
		}

		try {
			const localFavs = JSON.parse(local) as FavoriteItem[];
			if (localFavs.length > 0) {
				const res = await fetch(`${API_BASE}/favorites/sync`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ favorites: localFavs }),
					keepalive: true,
				});

				if (res.ok) {
					localStorage.removeItem("filspresso_favorites");
					notify("Your local favorites have been saved to your account!", 5000, "success");
				}
			}
			await fetchFavorites();
		} catch (error) {
			console.error("Sync favorites error", error);
			await fetchFavorites();
		}
	}, [fetchFavorites, notify, signedIn]);

	useEffect(() => {
		let cancelled = false;

		void fetchCurrentAccount().then((account) => {
			if (!cancelled) setSignedIn(Boolean(account));
		});

		const timeoutId = window.setTimeout(() => {
			void fetchFavorites();
			const local = localStorage.getItem("filspresso_favorites");
			if (local) {
				void syncFavorites();
			}
		}, 0);

		const handleSessionUpdate = () => {
			void syncFavorites();
		};

		window.addEventListener("session-update", handleSessionUpdate);
		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
			window.removeEventListener("session-update", handleSessionUpdate);
		};
	}, [fetchFavorites, syncFavorites]);

	const isFavorite = useCallback(
		(type: "capsule" | "machine", id: string) => {
			return favorites.some((f) => f.product_type === type && f.product_id === id);
		},
		[favorites],
	);

	const toggleFavorite = useCallback(
		async (type: "capsule" | "machine", id: string, category: string) => {
			const alreadyFavorite = isFavorite(type, id);

			let newFavs: FavoriteItem[];
			if (alreadyFavorite) {
				newFavs = favorites.filter((f) => !(f.product_type === type && f.product_id === id));
			} else {
				newFavs = [...favorites, { product_type: type, product_id: id, product_category: category }];
			}

			// Optimistic UI update
			setFavorites(newFavs);

			if (!signedIn) {
				// Guest: Update localStorage
				localStorage.setItem("filspresso_favorites", JSON.stringify(newFavs));
				notify(alreadyFavorite ? "Removed from favorites" : "Added to favorites", 3000, "info");
			} else {
				// Authenticated: Sync with API
				try {
					if (alreadyFavorite) {
						await fetch(`${API_BASE}/favorites/${type}/${id}`, {
							method: "DELETE",
							keepalive: true,
						});
					} else {
						await fetch(`${API_BASE}/favorites`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
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
		[favorites, isFavorite, notify, fetchFavorites, signedIn],
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
