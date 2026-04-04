"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import "../../styles/admin.css";
import {
	ArrowBigLeftDashIcon,
	ArrowBigLeftIcon,
	ArrowBigRightDashIcon,
	ArrowBigRightIcon,
	ChartBarIcon,
	EyeIcon,
	EyeOffIcon,
	FileDescriptionIcon,
	GearIcon,
	LockIcon,
	MagnifierIcon,
	PenIcon,
	RefreshIcon,
	SimpleCheckedIcon,
	TrashIcon,
	UserCheckIcon,
	UserPlusIcon,
	XIcon,
} from "@/icons";

const ADMIN_API_BASE = "/api/admin";
const ADMIN_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

type Column = {
	name: string;
	type: string;
	nullable: boolean;
	isPrimary: boolean;
	isAutoIncrement: boolean;
	defaultValue: string | null;
	maxLength: number | null;
	comment: string;
};

type TableInfo = {
	name: string;
	rowCount: number;
	comment: string;
};

type RowData = Record<string, unknown>;

type Pagination = {
	page: number;
	limit: number;
	total: number;
	totalPages: number;
};

const SENSITIVE_TABLE_NAMES = new Set([
	"auth_login_attempts",
	"auth_security_events",
	"admin_mfa_challenges",
	"user_mfa_challenges",
	"user_sessions",
	"user_cards",
]);

export default function AdminPage() {
	const router = useRouter();
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [adminToken, setAdminToken] = useState<string | null>(null);
	const [sensitiveModeEnabled, setSensitiveModeEnabled] = useState(false);
	const [sensitivePassword, setSensitivePassword] = useState("");
	const [sensitiveUnlockError, setSensitiveUnlockError] = useState("");
	const [isSensitiveUnlocking, setIsSensitiveUnlocking] = useState(false);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [loginError, setLoginError] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [isUploadingImage, setIsUploadingImage] = useState(false);
	const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
	const [pendingUploadMode, setPendingUploadMode] = useState<"new" | "edit" | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Table state
	const [tables, setTables] = useState<TableInfo[]>([]);
	const [selectedTable, setSelectedTable] = useState<string | null>(null);
	const [columns, setColumns] = useState<Column[]>([]);
	const [primaryKey, setPrimaryKey] = useState<string>("id");
	const [tableData, setTableData] = useState<RowData[]>([]);
	const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 10, total: 0, totalPages: 0 });
	const [sortBy, setSortBy] = useState<string>("id");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
	const [searchQuery, setSearchQuery] = useState("");

	// Edit state
	const [editingRow, setEditingRow] = useState<RowData | null>(null);
	const [editedData, setEditedData] = useState<RowData>({});
	const [isAddingRow, setIsAddingRow] = useState(false);
	const [newRowData, setNewRowData] = useState<RowData>({});
	const [actionError, setActionError] = useState("");
	const [actionSuccess, setActionSuccess] = useState("");

	// Check for existing session
	useEffect(() => {
		const bootstrapSession = async () => {
			try {
				const res = await fetch(`${ADMIN_API_BASE}/session`, { method: "GET" });

				if (!res.ok) {
					router.replace("/admin-login");
					return;
				}

				setAdminToken("cookie-session");
				setIsAuthenticated(true);
			} catch {
				router.replace("/admin-login");
			}
		};

		bootstrapSession();
	}, [router]);

	const clearInactivityTimer = useCallback(() => {
		if (inactivityTimerRef.current) {
			clearTimeout(inactivityTimerRef.current);
			inactivityTimerRef.current = null;
		}
	}, []);

	const handleLogout = useCallback(
		async (reason = "", notifyServer = true) => {
			clearInactivityTimer();
			if (notifyServer) {
				try {
					await fetch(`${ADMIN_API_BASE}/logout`, { method: "POST" });
				} catch {
					// Ignore logout errors
				}
			}
			setAdminToken(null);
			setIsAuthenticated(false);
			setSensitiveModeEnabled(false);
			setSensitivePassword("");
			setSensitiveUnlockError("");
			setIsSensitiveUnlocking(false);
			setSelectedTable(null);
			setTables([]);
			setColumns([]);
			setTableData([]);
			setEditingRow(null);
			setEditedData({});
			setIsAddingRow(false);
			setNewRowData({});
			setPendingUploadFile(null);
			setPendingUploadMode(null);
			setActionError("");
			setActionSuccess("");
			setLoginError(reason);
			router.replace("/admin-login");
		},
		[clearInactivityTimer, router],
	);

	const authenticatedAdminFetch = useCallback(
		async (input: string, init: RequestInit = {}) => {
			if (!adminToken) {
				return null;
			}

			const response = await fetch(input, init);

			if (response.status === 401) {
				await handleLogout("Admin session expired. Please log in again.", false);
				return null;
			}

			return response;
		},
		[adminToken, handleLogout],
	);

	// Fetch tables when authenticated
	useEffect(() => {
		if (isAuthenticated && adminToken) {
			fetchTables();
		}
	}, [isAuthenticated, adminToken]);

	useEffect(() => {
		if (!isAuthenticated || !adminToken) {
			clearInactivityTimer();
			return;
		}

		const resetInactivityTimer = () => {
			clearInactivityTimer();
			inactivityTimerRef.current = setTimeout(() => {
				handleLogout("Logged out after 5 minutes of inactivity.", false);
			}, ADMIN_INACTIVITY_TIMEOUT_MS);
		};

		const activityEvents: Array<keyof WindowEventMap> = ["click", "keydown", "mousemove", "scroll", "touchstart"];
		activityEvents.forEach((eventName) => {
			window.addEventListener(eventName, resetInactivityTimer, { passive: true });
		});

		resetInactivityTimer();

		return () => {
			activityEvents.forEach((eventName) => {
				window.removeEventListener(eventName, resetInactivityTimer);
			});
			clearInactivityTimer();
		};
	}, [isAuthenticated, adminToken, clearInactivityTimer, handleLogout]);

	// Fetch table data when table is selected
	useEffect(() => {
		if (selectedTable && adminToken) {
			fetchTableInfo(selectedTable);
			fetchTableData(selectedTable);
		}
	}, [selectedTable, adminToken, pagination.page, sortBy, sortOrder]);

	const handleLogin = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoginError("");
		setIsLoading(true);

		try {
			const res = await fetch(`${ADMIN_API_BASE}/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username, password }),
			});

			const data = await res.json();

			if (res.status === 202 && (data?.requiresMfa || data?.requiresMfaEnrollment)) {
				router.replace("/admin-login");
				return;
			}

			if (!res.ok) {
				setLoginError(data.error || "Login failed");
				return;
			}

			setAdminToken("cookie-session");
			setIsAuthenticated(true);
			setLoginError("");
			setPassword("");
		} catch {
			setLoginError("Failed to connect to server");
		} finally {
			setIsLoading(false);
		}
	};

	const fetchTables = async () => {
		try {
			const res = await authenticatedAdminFetch(`${ADMIN_API_BASE}/tables`);
			if (!res) return;

			const data = await res.json();
			if (data.tables) {
				setTables(data.tables);
			}
		} catch {
			console.error("Failed to fetch tables");
		}
	};

	const handleUnlockSensitiveMode = async (e: React.FormEvent) => {
		e.preventDefault();
		setSensitiveUnlockError("");
		setIsSensitiveUnlocking(true);

		try {
			const res = await authenticatedAdminFetch(`${ADMIN_API_BASE}/sensitive/unlock`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password: sensitivePassword }),
			});
			if (!res) return;

			const data = await res.json();
			if (!res.ok) {
				setSensitiveUnlockError(data.error || "Failed to unlock sensitive mode");
				return;
			}

			setSensitiveModeEnabled(true);
			setSensitivePassword("");
			fetchTables();
			if (selectedTable) {
				fetchTableInfo(selectedTable);
				fetchTableData(selectedTable);
			}
		} catch {
			setSensitiveUnlockError("Failed to connect to server");
		} finally {
			setIsSensitiveUnlocking(false);
		}
	};

	const handleLockSensitiveMode = async () => {
		try {
			await authenticatedAdminFetch(`${ADMIN_API_BASE}/sensitive/lock`, { method: "POST" });
		} catch {
			// Ignore lock errors
		} finally {
			setSensitiveModeEnabled(false);
			setSensitivePassword("");
			setSensitiveUnlockError("");
			setSelectedTable(null);
			setColumns([]);
			setTableData([]);
			fetchTables();
			if (selectedTable) {
				fetchTableInfo(selectedTable);
				fetchTableData(selectedTable);
			}
		}
	};

	const fetchTableInfo = async (table: string) => {
		try {
			const res = await authenticatedAdminFetch(`${ADMIN_API_BASE}/table-info/${table}`);
			if (!res) return;
			const data = await res.json();
			if (data.columns) {
				setColumns(data.columns);
				setPrimaryKey(data.primaryKey || "id");
			}
		} catch {
			console.error("Failed to fetch table info");
		}
	};

	const fetchTableData = useCallback(
		async (table: string) => {
			setIsLoading(true);
			try {
				const params = new URLSearchParams({
					page: pagination.page.toString(),
					limit: pagination.limit.toString(),
					sortBy,
					sortOrder,
					...(searchQuery && { search: searchQuery }),
				});

				const res = await authenticatedAdminFetch(`${ADMIN_API_BASE}/tables/${table}?${params}`);
				if (!res) return;
				const data = await res.json();
				if (data.data) {
					setTableData(data.data);
					setPagination(data.pagination);
				}
			} catch {
				console.error("Failed to fetch table data");
			} finally {
				setIsLoading(false);
			}
		},
		[authenticatedAdminFetch, pagination.page, pagination.limit, sortBy, sortOrder, searchQuery],
	);

	useEffect(() => {
		if (!isAuthenticated || !adminToken) {
			return;
		}

		const refreshAdminData = () => {
			fetchTables();
			if (selectedTable) {
				fetchTableInfo(selectedTable);
				fetchTableData(selectedTable);
			}
		};

		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				refreshAdminData();
			}
		};

		window.addEventListener("focus", refreshAdminData);
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			window.removeEventListener("focus", refreshAdminData);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [isAuthenticated, adminToken, selectedTable, fetchTableData]);

	const handleSort = (column: string) => {
		if (sortBy === column) {
			setSortOrder(sortOrder === "asc" ? "desc" : "asc");
		} else {
			setSortBy(column);
			setSortOrder("asc");
		}
	};

	const handleSearch = (e: React.FormEvent) => {
		e.preventDefault();
		setPagination((p) => ({ ...p, page: 1 }));
		if (selectedTable) {
			fetchTableData(selectedTable);
		}
	};

	const handleEditRow = (row: RowData) => {
		setEditingRow(row);
		setEditedData({ ...row });
		setActionError("");
		setActionSuccess("");
	};

	const handleCancelEdit = () => {
		setEditingRow(null);
		setEditedData({});
	};

	// Ensure JSON fields are properly stringified and system fields are stripped/normalized
	const prepareDataForSave = (data: RowData): RowData => {
		const jsonFields = ["notes", "servings"];
		const prepared: RowData = { ...data };

		// Strip system/PK fields so DB handles them (avoids datetime format errors)
		delete prepared.id;
		delete prepared.created_at;
		delete prepared.updated_at;

		for (const field of jsonFields) {
			if (field in prepared) {
				const val = prepared[field];
				// If it's already a string, keep it; if it's an object/array, stringify it
				if (val !== null && val !== undefined && typeof val !== "string") {
					prepared[field] = JSON.stringify(val);
				}
			}
		}
		return prepared;
	};

	const handleSaveEdit = async () => {
		if (!selectedTable || !editingRow) return;
		setActionError("");
		setIsLoading(true);

		try {
			const readyForSave = await ensurePendingUploadBeforeSave(false);
			if (!readyForSave) return;

			const rowId = editingRow[primaryKey];
			const dataToSend = prepareDataForSave(editedData);
			const res = await authenticatedAdminFetch(`${ADMIN_API_BASE}/tables/${selectedTable}/${rowId}`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(dataToSend),
			});
			if (!res) return;

			const data = await res.json();
			if (!res.ok) {
				setActionError(data.error || "Failed to update row");
				return;
			}

			setActionSuccess("Row updated successfully");
			setEditingRow(null);
			setEditedData({});
			fetchTables();
			fetchTableData(selectedTable);
		} catch {
			setActionError("Failed to save changes");
		} finally {
			setIsLoading(false);
		}
	};

	const handleDeleteRow = async (row: RowData) => {
		if (!selectedTable) return;
		const rowId = row[primaryKey];

		if (!confirm(`Are you sure you want to delete this row (${primaryKey}: ${rowId})?`)) {
			return;
		}

		setActionError("");
		setIsLoading(true);

		try {
			const res = await authenticatedAdminFetch(`${ADMIN_API_BASE}/tables/${selectedTable}/${rowId}`, {
				method: "DELETE",
			});
			if (!res) return;

			const data = await res.json();
			if (!res.ok) {
				setActionError(data.error || "Failed to delete row");
				return;
			}

			setActionSuccess("Row deleted successfully");
			fetchTables();
			fetchTableData(selectedTable);
		} catch {
			setActionError("Failed to delete row");
		} finally {
			setIsLoading(false);
		}
	};

	const handleAddRow = () => {
		setIsAddingRow(true);
		setNewRowData({});
		setActionError("");
		setActionSuccess("");
	};

	const handleCancelAdd = () => {
		setIsAddingRow(false);
		setNewRowData({});
	};

	const handleSaveNewRow = async () => {
		if (!selectedTable) return;
		setActionError("");
		setIsLoading(true);

		try {
			const readyForSave = await ensurePendingUploadBeforeSave(true);
			if (!readyForSave) return;

			const dataToSend = prepareDataForSave(newRowData);
			const res = await authenticatedAdminFetch(`${ADMIN_API_BASE}/tables/${selectedTable}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(dataToSend),
			});
			if (!res) return;

			const data = await res.json();
			if (!res.ok) {
				setActionError(data.error || "Failed to insert row");
				return;
			}

			setActionSuccess(`Row inserted successfully (ID: ${data.insertId})`);
			setIsAddingRow(false);
			setNewRowData({});
			fetchTables();
			fetchTableData(selectedTable);
		} catch {
			setActionError("Failed to insert row");
		} finally {
			setIsLoading(false);
		}
	};

	const handleFieldChange = (field: string, value: string, isNew = false) => {
		if (isNew) {
			setNewRowData((prev) => ({ ...prev, [field]: value === "" ? null : value }));
		} else {
			setEditedData((prev) => ({ ...prev, [field]: value === "" ? null : value }));
		}
	};

	const normalizeCategoryKey = (value: string) =>
		(value || "")
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.trim();

	const CATEGORY_FOLDER_MAP: Record<string, Record<string, string>> = {
		original: {
			"coffee+": "Coffee+",
			"craft brew": "Craft Brew",
			"creations barista": "Barista Creations",
			"barista creations": "Barista Creations",
			espresso: "Espresso",
			"edition limitee": "Limited Edition",
			"limited edition": "Limited Edition",
			"ispirazione italiana": "Ispirazione Italiana",
			"italian explorations": "Italian Explorations",
			"origines principales": "Master Origins",
			"master origins": "Master Origins",
			"explorations du monde": "World Explorations",
			"world explorations": "World Explorations",
			tasse: "Mug",
			mug: "Mug",
		},
		vertuo: {
			"coffee+": "Coffee+",
			"craft brew": "Craft Brew",
			"double espresso": "Double Espresso",
			espresso: "Espressos",
			espressos: "Espressos",
			"gran lungo": "Gran Lungo",
			"edition limitee": "Limited Edition",
			"limited edition": "Limited Edition",
			"barista creation": "Barista Creation",
			"barista creations": "Barista Creation",
			"creations barista": "Barista Creation",
			"master origins": "Master Origins",
			"origines principales": "Master Origins",
			mug: "Mug",
			tasse: "Mug",
		},
	};

	const resolveCategoryFolder = (productType?: string | null, category?: string | null) => {
		const typeKey = productType?.toLowerCase() === "vertuo" ? "vertuo" : "original";
		const categoryKey = normalizeCategoryKey(category || "");
		const mapped = CATEGORY_FOLDER_MAP[typeKey]?.[categoryKey];
		const categoryDir = mapped || category || "Uncategorized";
		const typeDir = typeKey === "vertuo" ? "Vertuo" : "Original";
		return { typeDir, categoryDir };
	};

	const handleImageUpload = async (file: File | null, isNew = false): Promise<boolean> => {
		if (!file) return true;
		if (!selectedTable) return true;
		if (selectedTable !== "coffee_products") {
			setActionError("Image upload is only available for coffee_products.");
			return false;
		}

		const rowData = isNew ? newRowData : editedData;
		const productType = (rowData.product_type as string) || "";
		const category = (rowData.category as string) || "";

		if (!productType || !category) {
			setActionError("Please select product_type and category before uploading an image.");
			return false;
		}

		const formData = new FormData();
		// Append metadata first so Multer sees fields before the file part and resolves the proper folder
		formData.append("product_type", productType);
		formData.append("category", category);
		formData.append("image", file);

		setIsUploadingImage(true);
		setActionError("");
		setActionSuccess("");

		try {
			const res = await authenticatedAdminFetch(`${ADMIN_API_BASE}/upload/coffee-image`, {
				method: "POST",
				body: formData,
			});
			if (!res) return false;

			const data = await res.json();
			if (!res.ok) {
				setActionError(data.error || "Failed to upload image");
				return false;
			}

			handleFieldChange("image_filename", data.filename, isNew);
			handleFieldChange("image_extension", data.extension, isNew);
			setActionSuccess(`Image uploaded to ${data.relativePath}`);
			return true;
		} catch (error) {
			setActionError("Failed to upload image");
			return false;
		} finally {
			setIsUploadingImage(false);
		}
	};

	const ensurePendingUploadBeforeSave = async (isNew: boolean): Promise<boolean> => {
		if (selectedTable !== "coffee_products") return true;
		if (!pendingUploadFile) return true;
		const mode = pendingUploadMode ?? (isNew ? "new" : "edit");
		const uploadOk = await handleImageUpload(pendingUploadFile, mode === "new");
		if (uploadOk) {
			setPendingUploadFile(null);
			setPendingUploadMode(null);
		}
		return uploadOk;
	};

	const triggerPendingUpload = (isNew: boolean) => {
		const file = pendingUploadFile;
		const mode = pendingUploadMode ?? (isNew ? "new" : "edit");
		if (!file) {
			setActionError("Select an image file first.");
			return;
		}
		handleImageUpload(file, mode === "new");
		setPendingUploadFile(null);
		setPendingUploadMode(null);
	};

	const formatCellValue = (value: unknown): string => {
		if (value === null || value === undefined) return "NULL";
		if (typeof value === "object") {
			if (value instanceof Date) return value.toISOString();
			return JSON.stringify(value);
		}
		return String(value);
	};

	const visibleTables = tables.filter((table) => !SENSITIVE_TABLE_NAMES.has(table.name));
	const sensitiveTables = tables.filter((table) => SENSITIVE_TABLE_NAMES.has(table.name));

	// Dropdown options for specific fields
	const PRODUCT_TYPE_OPTIONS = ["original", "vertuo"];
	const CATEGORY_OPTIONS = [
		"Coffee+",
		"Craft Brew",
		"Créations Barista",
		"Double Espresso",
		"Édition Limitée",
		"Espresso",
		"Espressos",
		"Explorations du Monde",
		"Gran Lungo",
		"Ispirazione Italiana",
		"Italian Explorations",
		"Origines Principales",
		"Tasse",
	];
	const IMAGE_EXTENSION_OPTIONS = ["png", "avif", "webp"];
	const IMAGE_STYLE_SCALE_OPTIONS = ["", "1", "0.95", "0.9", "0.84", "0.8"];
	const IMAGE_STYLE_MARGIN_OPTIONS = ["", "0", "0%", "-5%", "-10%"];
	const PRICE_CLASS_OPTIONS = ["", "bag_group", "bag_group_2", "bag_group_3", "bag_group_4", "bag_group_5", "bag_group_6"];
	const SERVING_OPTIONS = [
		{ title: "Ristretto", volume: "25 ml", icon: "images/svg/ristretto.svg" },
		{ title: "Espresso", volume: "40 ml", icon: "images/svg/espresso.svg" },
		{ title: "Lungo", volume: "110 ml", icon: "images/svg/lungo.svg" },
		{ title: "Double Espresso", volume: "80 ml", icon: "images/svg/lungo vl.svg" },
		{ title: "Gran Lungo", volume: "150 ml", icon: "images/svg/gran lungo vl.svg" },
		{ title: "Mug", volume: "230 ml", icon: "images/svg/mug.svg" },
		{ title: "Alto", volume: "414 ml", icon: "images/svg/alto vl.svg" },
		{ title: "Carafe", volume: "535 ml", icon: "images/svg/carafe vl.svg" },
		{ title: "Cappuccino", volume: "Latte", icon: "images/svg/milk recipies.svg" },
		{ title: "Reverso", volume: "Latte", icon: "images/svg/reverso.svg" },
		{ title: "Cold-Brew", volume: "Iced", icon: "images/svg/iced vl.svg" },
	];

	const parseImageStyle = (style: string | null | undefined) => {
		const safe = style || "";
		const scaleMatch = safe.match(/scale:\s*([0-9.]+)/i);
		const marginMatch = safe.match(/margin-top:\s*([^;]+)/i);
		return {
			scale: scaleMatch ? scaleMatch[1].trim() : "",
			marginTop: marginMatch ? marginMatch[1].trim() : "",
		};
	};

	const buildImageStyle = (scale: string, marginTop: string) => {
		const parts: string[] = [];
		if (scale) parts.push(`scale: ${scale}`);
		if (marginTop) parts.push(`margin-top: ${marginTop}`);
		return parts.length ? `${parts.join("; ")};` : "";
	};

	const renderCellInput = (column: Column, value: unknown, isNew = false) => {
		const strValue = value === null || value === undefined ? "" : String(value);

		if (column.isAutoIncrement && !isNew) {
			return <span className="readonly-value">{strValue}</span>;
		}

		// Notes table editor (JSON array of strings)
		if (column.name === "notes") {
			let noteList: string[] = [];
			try {
				noteList = strValue ? JSON.parse(strValue) : [];
				if (!Array.isArray(noteList)) noteList = [];
				noteList = noteList.map((n) => (typeof n === "string" ? n : ""));
			} catch {
				noteList = [];
			}

			const updateNote = (idx: number, newValue: string) => {
				const updated = [...noteList];
				updated[idx] = newValue;
				handleFieldChange(column.name, JSON.stringify(updated), isNew);
			};

			const addNote = () => {
				handleFieldChange(column.name, JSON.stringify([...noteList, ""]), isNew);
			};

			const removeNote = (idx: number) => {
				const updated = noteList.filter((_, i) => i !== idx);
				handleFieldChange(column.name, JSON.stringify(updated), isNew);
			};

			return (
				<div className="notes-table">
					<div className="notes-rows">
						{noteList.map((note, idx) => (
							<div key={idx} className="note-row">
								<input
									type="text"
									value={note}
									onChange={(e) => updateNote(idx, e.target.value)}
									className="note-input"
									placeholder={`Note ${idx + 1}`}
								/>
								<button type="button" className="note-remove" onClick={() => removeNote(idx)}>
									<XIcon size={12} />
								</button>
							</div>
						))}
					</div>
					<button type="button" className="note-add" onClick={addNote}>
						<UserPlusIcon size={14} /> Add note
					</button>
				</div>
			);
		}

		// Product type dropdown
		if (column.name === "product_type") {
			return (
				<select
					value={strValue}
					onChange={(e) => handleFieldChange(column.name, e.target.value, isNew)}
					className="cell-select"
				>
					<option value="">-- Select --</option>
					{PRODUCT_TYPE_OPTIONS.map((opt) => (
						<option key={opt} value={opt}>
							{opt}
						</option>
					))}
				</select>
			);
		}

		// Category dropdown
		if (column.name === "category") {
			return (
				<select
					value={strValue}
					onChange={(e) => handleFieldChange(column.name, e.target.value, isNew)}
					className="cell-select"
				>
					<option value="">-- Select --</option>
					{CATEGORY_OPTIONS.map((opt) => (
						<option key={opt} value={opt}>
							{opt}
						</option>
					))}
				</select>
			);
		}

		// Image filename with upload helper
		if (column.name === "image_filename") {
			const rowData = isNew ? newRowData : editedData;
			const { typeDir, categoryDir } = resolveCategoryFolder(
				(rowData.product_type as string) || "",
				(rowData.category as string) || "",
			);

			const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
				const file = event.target.files?.[0];
				setPendingUploadFile(file || null);
				setPendingUploadMode(isNew ? "new" : "edit");
				setActionError("");
				setActionSuccess("");

				// Auto-populate filename and extension for visibility before upload
				if (file) {
					const nameParts = file.name.split(".");
					const ext = nameParts.length > 1 ? nameParts.pop() || "" : "";
					const base = nameParts.join(".");
					handleFieldChange("image_filename", file.name, isNew);
					handleFieldChange("image_extension", ext.toLowerCase(), isNew);
					// If no product name yet, prefill name from base
					if (!((isNew ? newRowData : editedData).name as string)) {
						handleFieldChange("name", base, isNew);
					}
				}
				// Reset the input so the same file can be re-selected if needed
				event.target.value = "";
			};

			return (
				<div className="image-upload">
					<input
						type="text"
						value={strValue}
						onChange={(e) => handleFieldChange(column.name, e.target.value, isNew)}
						className="cell-input"
						placeholder="image filename (auto-set after upload)"
					/>
					<div className="image-upload-row">
						<input
							type="file"
							accept=".png,.avif,.webp,.jpg,.jpeg"
							onChange={onFileChange}
							ref={fileInputRef}
							className="file-input"
							disabled={isUploadingImage}
						/>
						<button
							type="button"
							onClick={() => {
								if (!pendingUploadFile) {
									fileInputRef.current?.click();
									return;
								}
								triggerPendingUpload(isNew);
							}}
							className="upload-button"
							disabled={isUploadingImage}
						>
							{isUploadingImage ? "Uploading..." : "Upload"}
						</button>
						<span className="upload-status">
							{pendingUploadFile ? pendingUploadFile.name : "Select a file then click Upload"}
						</span>
					</div>
					<small className="upload-hint">
						Destination: images/Capsules/{typeDir}/{categoryDir} (extension auto-detected)
					</small>
				</div>
			);
		}

		// Image extension dropdown
		if (column.name === "image_extension") {
			return (
				<select
					value={strValue}
					onChange={(e) => handleFieldChange(column.name, e.target.value, isNew)}
					className="cell-select"
				>
					<option value="">-- Select --</option>
					{IMAGE_EXTENSION_OPTIONS.map((opt) => (
						<option key={opt} value={opt}>
							{opt}
						</option>
					))}
				</select>
			);
		}

		// Image style composed from scale + margin-top selectors
		if (column.name === "image_style") {
			const { scale, marginTop } = parseImageStyle(strValue);
			const updateStyle = (newScale: string, newMarginTop: string) => {
				handleFieldChange(column.name, buildImageStyle(newScale, newMarginTop), isNew);
			};

			return (
				<div className="image-style-fields">
					<div className="image-style-row">
						<label className="inline-label">Scale</label>
						<select value={scale} onChange={(e) => updateStyle(e.target.value, marginTop)} className="cell-select">
							{IMAGE_STYLE_SCALE_OPTIONS.map((opt) => (
								<option key={opt || "default"} value={opt}>
									{opt === "" ? "Default" : opt}
								</option>
							))}
						</select>
					</div>
					<div className="image-style-row">
						<label className="inline-label">Margin-Top</label>
						<select value={marginTop} onChange={(e) => updateStyle(scale, e.target.value)} className="cell-select">
							{IMAGE_STYLE_MARGIN_OPTIONS.map((opt) => (
								<option key={opt || "default"} value={opt}>
									{opt === "" ? "Default" : opt}
								</option>
							))}
						</select>
					</div>
					<small className="image-style-preview">{buildImageStyle(scale, marginTop) || "No custom style"}</small>
				</div>
			);
		}

		// Price class dropdown
		if (column.name === "price_class") {
			return (
				<select
					value={strValue}
					onChange={(e) => handleFieldChange(column.name, e.target.value, isNew)}
					className="cell-select"
				>
					{PRICE_CLASS_OPTIONS.map((opt) => (
						<option key={opt || "default"} value={opt}>
							{opt === "" ? "default" : opt}
						</option>
					))}
				</select>
			);
		}

		// Servings multi-select (max 2)
		if (column.name === "servings") {
			let currentServings: Array<{ title: string; volume: string; icon: string }> = [];
			try {
				currentServings = strValue ? JSON.parse(strValue) : [];
			} catch {
				currentServings = [];
			}

			const toggleServing = (serving: { title: string; volume: string; icon: string }) => {
				const exists = currentServings.some((s) => s.title === serving.title);
				let newServings;
				if (exists) {
					newServings = currentServings.filter((s) => s.title !== serving.title);
				} else if (currentServings.length < 2) {
					newServings = [...currentServings, serving];
				} else {
					return; // Max 2 servings
				}
				handleFieldChange(column.name, JSON.stringify(newServings), isNew);
			};

			return (
				<div className="servings-select">
					<div className="servings-chips">
						{SERVING_OPTIONS.map((serving) => {
							const isSelected = currentServings.some((s) => s.title === serving.title);
							return (
								<button
									key={serving.title}
									type="button"
									onClick={() => toggleServing(serving)}
									className={`serving-chip ${isSelected ? "selected" : ""}`}
									disabled={!isSelected && currentServings.length >= 2}
									title={`${serving.title} (${serving.volume})`}
								>
									{serving.title}
								</button>
							);
						})}
					</div>
					<small className="servings-hint">Selected: {currentServings.length}/2</small>
				</div>
			);
		}

		if (column.type === "text" || column.type === "longtext" || column.type === "mediumtext") {
			return (
				<textarea
					value={strValue}
					onChange={(e) => handleFieldChange(column.name, e.target.value, isNew)}
					className="cell-textarea"
					rows={3}
				/>
			);
		}

		if (column.type === "tinyint" && column.maxLength === 1) {
			return (
				<select
					value={strValue}
					onChange={(e) => handleFieldChange(column.name, e.target.value, isNew)}
					className="cell-select"
				>
					<option value="">NULL</option>
					<option value="0">0 (false)</option>
					<option value="1">1 (true)</option>
				</select>
			);
		}

		return (
			<input
				type={column.type.includes("int") || column.type === "decimal" ? "number" : "text"}
				value={strValue}
				onChange={(e) => handleFieldChange(column.name, e.target.value, isNew)}
				className="cell-input"
				placeholder={column.nullable ? "NULL" : ""}
			/>
		);
	};

	// Login screen
	if (!isAuthenticated) {
		return (
			<div className="admin-login-container">
				<div className="admin-login-card">
					<div className="admin-login-header">
						<span className="admin-login-kicker">Filspresso Control Room</span>
						<h1 className="admin-login-title">
							<span className="admin-icon admin-icon--lg">
								<LockIcon size={18} />
							</span>
							Admin Panel
						</h1>
						<p className="admin-login-copy">
							Filspresso database management with the same coffee-house visual system as the main app.
						</p>
					</div>
					<form onSubmit={handleLogin} className="admin-login-form">
						<div className="form-group">
							<label htmlFor="username">Username</label>
							<input
								id="username"
								type="text"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								placeholder="Admin username"
								autoComplete="username"
								required
							/>
						</div>
						<div className="form-group">
							<label htmlFor="password">Password</label>
							<div className="password-input-wrapper">
								<input
									id="password"
									type={showPassword ? "text" : "password"}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="Admin password"
									autoComplete="current-password"
									required
									className="admin-password-input"
								/>
								<button
									type="button"
									onClick={() => setShowPassword(!showPassword)}
									className="password-toggle-btn"
									title={showPassword ? "Hide password" : "Show password"}
								>
									{showPassword ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
								</button>
							</div>
						</div>
						{loginError && <div className="error-message">{loginError}</div>}
						<button type="submit" className="login-button" disabled={isLoading}>
							{isLoading ? (
								"Logging in..."
							) : (
								<>
									<UserCheckIcon size={20} /> <span className="login-button-label">Login</span>
								</>
							)}
						</button>
					</form>
				</div>
			</div>
		);
	}

	// Admin dashboard
	return (
		<div className="admin-container">
			{/* Header */}
			<header className="admin-header">
				<div className="admin-header-left">
					<div>
						<span className="admin-kicker">Filspresso Operations</span>
						<h1>
							<span className="admin-icon admin-icon--lg">
								<GearIcon size={18} />
							</span>
							Filspresso Admin
						</h1>
					</div>
					<span className="admin-subtitle">Database Management</span>
				</div>
				<div className="admin-header-right">
					{sensitiveModeEnabled ? <span className="admin-status-pill">Sensitive mode</span> : null}
					<span className="admin-status-pill">Live workspace</span>
					<span className="admin-user">
						<span className="admin-icon">
							<UserCheckIcon size={16} />
						</span>
						Admin
					</span>
					<button onClick={() => handleLogout()} className="logout-button">
						Logout
					</button>
				</div>
			</header>

			<div className="admin-main">
				{/* Sidebar - Table List */}
				<aside className="admin-sidebar">
					<div className="admin-sidebar-header" style={{ marginBottom: "1rem" }}>
						<h2>
							<span className="admin-icon">
								<LockIcon size={16} />
							</span>
							Sensitive Mode
						</h2>
						<p>Unlock to view masked credentials, MFA secrets, and other privileged fields.</p>
						{!sensitiveModeEnabled ? (
							<form
								onSubmit={handleUnlockSensitiveMode}
								className="admin-login-form"
								style={{ marginTop: "0.75rem" }}
							>
								<div className="form-group">
									<label htmlFor="sensitive-password">Re-enter admin password</label>
									<input
										id="sensitive-password"
										type="password"
										value={sensitivePassword}
										onChange={(e) => setSensitivePassword(e.target.value)}
										placeholder="Password"
										autoComplete="current-password"
										required
									/>
								</div>
								{sensitiveUnlockError && <div className="error-message">{sensitiveUnlockError}</div>}
								<button type="submit" className="login-button" disabled={isSensitiveUnlocking}>
									{isSensitiveUnlocking ? "Unlocking..." : "Unlock Sensitive Mode"}
								</button>
							</form>
						) : (
							<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.75rem" }}>
								<div className="action-success">Sensitive mode is enabled for this session.</div>
								<button type="button" className="logout-button" onClick={handleLockSensitiveMode}>
									Lock Sensitive Mode
								</button>
							</div>
						)}
					</div>
					<div className="admin-sidebar-header" style={{ marginTop: "1.25rem" }}>
						<h2>
							<span className="admin-icon">
								<ChartBarIcon size={16} />
							</span>
							Tables
						</h2>
						<p>Browse and manage the live tables used by the storefront and account flows.</p>
						{!sensitiveModeEnabled && <p>Enable sensitive mode to inspect privileged tables and hidden fields.</p>}
					</div>
					<ul className="table-list">
						{visibleTables.map((table) => (
							<li
								key={table.name}
								className={`table-item ${selectedTable === table.name ? "active" : ""}`}
								onClick={() => {
									setSelectedTable(table.name);
									setPagination((p) => ({ ...p, page: 1 }));
									setSearchQuery("");
								}}
							>
								<span className="table-name">{table.name}</span>
								<span className="table-count">{table.rowCount}</span>
							</li>
						))}
					</ul>
					{sensitiveModeEnabled && sensitiveTables.length > 0 ? (
						<>
							<div className="admin-sidebar-header" style={{ marginTop: "1.5rem" }}>
								<h2>
									<span className="admin-icon">
										<LockIcon size={16} />
									</span>
									Sensitive Data
								</h2>
								<p>Secret-bearing tables and card storage. Keep this locked unless you need it.</p>
							</div>
							<ul className="table-list">
								{sensitiveTables.map((table) => (
									<li
										key={table.name}
										className={`table-item ${selectedTable === table.name ? "active" : ""}`}
										onClick={() => {
											setSelectedTable(table.name);
											setPagination((p) => ({ ...p, page: 1 }));
											setSearchQuery("");
										}}
									>
										<span className="table-name">{table.name}</span>
										<span className="table-count">{table.rowCount}</span>
									</li>
								))}
							</ul>
						</>
					) : null}
				</aside>

				{/* Main Content */}
				<main className="admin-content">
					{!selectedTable ? (
						<div className="no-table-selected">
							<div className="empty-state">
								<span className="empty-kicker">Database overview</span>
								<span className="empty-icon">
									<FileDescriptionIcon size={48} />
								</span>
								<h2>Select a Table</h2>
								<p>Choose a table from the sidebar to view and manage its data</p>
							</div>
						</div>
					) : (
						<section className="admin-panel">
							{/* Table Header */}
							<div className="table-header">
								<div className="table-title">
									<h2>{selectedTable}</h2>
									<span className="row-count">{pagination.total} rows</span>
								</div>
								<div className="table-actions">
									<form onSubmit={handleSearch} className="search-form">
										<input
											type="text"
											value={searchQuery}
											onChange={(e) => setSearchQuery(e.target.value)}
											placeholder="Search..."
											className="search-input"
										/>
										<button type="submit" className="search-button">
											<MagnifierIcon size={16} />
										</button>
									</form>
									<button onClick={handleAddRow} className="add-row-button">
										<UserPlusIcon size={16} /> Add Row
									</button>
									<button
										onClick={() => {
											fetchTables();
											fetchTableData(selectedTable);
										}}
										className="refresh-button"
									>
										<RefreshIcon size={16} /> Refresh
									</button>
								</div>
							</div>

							{/* Messages */}
							{actionError && <div className="action-error">{actionError}</div>}
							{actionSuccess && <div className="action-success">{actionSuccess}</div>}

							{/* Add Row Form */}
							{isAddingRow && (
								<div className="add-row-form">
									<h3>Add New Row</h3>
									<div className="form-grid">
										{columns
											.filter((c) => !c.isAutoIncrement)
											.filter((column) => {
												if (selectedTable === "machine_products") {
													return column.name !== "image";
												}
												return true;
											})
											.map((column) => (
												<div key={column.name} className="form-field">
													<label>
														{column.name}
														{!column.nullable && <span className="required">*</span>}
														<span className="field-type">({column.type})</span>
													</label>
													{renderCellInput(column, newRowData[column.name], true)}
												</div>
											))}
									</div>
									<div className="form-actions">
										<button onClick={handleSaveNewRow} className="save-button" disabled={isLoading}>
											<SimpleCheckedIcon size={16} /> Save
										</button>
										<button onClick={handleCancelAdd} className="cancel-button">
											Cancel
										</button>
									</div>
								</div>
							)}

							{/* Data Table */}
							<div className="data-table-container">
								{isLoading && <div className="loading-overlay">Loading...</div>}
								<table className="data-table">
									<thead>
										<tr>
											<th className="actions-column">Actions</th>
											{columns
												.filter((column) => {
													if (selectedTable === "machine_products") {
														return column.name !== "image";
													}
													return true;
												})
												.map((column) => (
													<th
														key={column.name}
														onClick={() => handleSort(column.name)}
														className={`sortable ${sortBy === column.name ? "sorted" : ""}`}
													>
														{column.name}
														{column.isPrimary && <span className="pk-badge">PK</span>}
														{sortBy === column.name && (
															<span className="sort-indicator">
																{sortOrder === "asc" ? "▲" : "▼"}
															</span>
														)}
													</th>
												))}
										</tr>
									</thead>
									<tbody>
										{tableData.map((row, idx) => (
											<tr key={idx} className={editingRow === row ? "editing" : ""}>
												<td className="actions-cell">
													{editingRow === row ? (
														<>
															<button
																onClick={handleSaveEdit}
																className="action-btn save"
																title="Save"
															>
																<SimpleCheckedIcon size={16} />
															</button>
															<button
																onClick={handleCancelEdit}
																className="action-btn cancel"
																title="Cancel"
															>
																<XIcon size={16} />
															</button>
														</>
													) : (
														<>
															<button
																onClick={() => handleEditRow(row)}
																className="action-btn edit"
																title="Edit"
															>
																<PenIcon size={16} />
															</button>
															<button
																onClick={() => handleDeleteRow(row)}
																className="action-btn delete"
																title="Delete"
															>
																<TrashIcon size={16} />
															</button>
														</>
													)}
												</td>
												{columns
													.filter((column) => {
														if (selectedTable === "machine_products") {
															return column.name !== "image";
														}
														return true;
													})
													.map((column) => (
														<td
															key={column.name}
															className={row[column.name] === null ? "null-value" : ""}
														>
															{editingRow === row ? (
																renderCellInput(column, editedData[column.name])
															) : (
																<span className="cell-value">
																	{formatCellValue(row[column.name])}
																</span>
															)}
														</td>
													))}
											</tr>
										))}
									</tbody>
								</table>
							</div>

							{/* Pagination */}
							{pagination.totalPages > 1 && (
								<div className="pagination">
									<button
										onClick={() => setPagination((p) => ({ ...p, page: 1 }))}
										disabled={pagination.page === 1}
										className="page-btn"
									>
										<ArrowBigLeftDashIcon size={16} />
									</button>
									<button
										onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
										disabled={pagination.page === 1}
										className="page-btn"
									>
										<ArrowBigLeftIcon size={16} />
									</button>
									<span className="page-info">
										Page {pagination.page} of {pagination.totalPages}
									</span>
									<button
										onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
										disabled={pagination.page === pagination.totalPages}
										className="page-btn"
									>
										<ArrowBigRightIcon size={16} />
									</button>
									<button
										onClick={() => setPagination((p) => ({ ...p, page: p.totalPages }))}
										disabled={pagination.page === pagination.totalPages}
										className="page-btn"
									>
										<ArrowBigRightDashIcon size={16} />
									</button>
								</div>
							)}

							{/* Column Info */}
							<details className="column-info">
								<summary>
									<span className="admin-icon">
										<FileDescriptionIcon size={16} />
									</span>
									Column Schema
								</summary>
								<table className="schema-table">
									<thead>
										<tr>
											<th>Column</th>
											<th>Type</th>
											<th>Nullable</th>
											<th>Key</th>
											<th>Default</th>
											<th>Extra</th>
										</tr>
									</thead>
									<tbody>
										{columns.map((col) => (
											<tr key={col.name}>
												<td>{col.name}</td>
												<td>
													{col.type}
													{col.maxLength && `(${col.maxLength})`}
												</td>
												<td>{col.nullable ? "YES" : "NO"}</td>
												<td>{col.isPrimary ? "PRI" : ""}</td>
												<td>{col.defaultValue ?? "NULL"}</td>
												<td>{col.isAutoIncrement ? "auto_increment" : ""}</td>
											</tr>
										))}
									</tbody>
								</table>
							</details>
						</section>
					)}
				</main>
			</div>
		</div>
	);
}
