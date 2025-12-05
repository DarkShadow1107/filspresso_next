"use client";

import React, { useState, useEffect, useCallback } from "react";
import "@/styles/admin.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

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

export default function AdminPage() {
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [adminToken, setAdminToken] = useState<string | null>(null);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [loginError, setLoginError] = useState("");
	const [isLoading, setIsLoading] = useState(false);

	// Table state
	const [tables, setTables] = useState<TableInfo[]>([]);
	const [selectedTable, setSelectedTable] = useState<string | null>(null);
	const [columns, setColumns] = useState<Column[]>([]);
	const [primaryKey, setPrimaryKey] = useState<string>("id");
	const [tableData, setTableData] = useState<RowData[]>([]);
	const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
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
		const token = sessionStorage.getItem("admin_token");
		if (token) {
			setAdminToken(token);
			setIsAuthenticated(true);
		}
	}, []);

	// Fetch tables when authenticated
	useEffect(() => {
		if (isAuthenticated && adminToken) {
			fetchTables();
		}
	}, [isAuthenticated, adminToken]);

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
			const res = await fetch(`${API_BASE}/api/admin/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username, password }),
			});

			const data = await res.json();

			if (!res.ok) {
				setLoginError(data.error || "Login failed");
				return;
			}

			setAdminToken(data.token);
			sessionStorage.setItem("admin_token", data.token);
			setIsAuthenticated(true);
			setPassword("");
		} catch {
			setLoginError("Failed to connect to server");
		} finally {
			setIsLoading(false);
		}
	};

	const handleLogout = async () => {
		try {
			await fetch(`${API_BASE}/api/admin/logout`, {
				method: "POST",
				headers: { Authorization: `Bearer ${adminToken}` },
			});
		} catch {
			// Ignore logout errors
		}
		sessionStorage.removeItem("admin_token");
		setAdminToken(null);
		setIsAuthenticated(false);
		setSelectedTable(null);
		setTables([]);
	};

	const fetchTables = async () => {
		try {
			const res = await fetch(`${API_BASE}/api/admin/tables`, {
				headers: { Authorization: `Bearer ${adminToken}` },
			});

			// Handle expired/invalid token
			if (res.status === 401) {
				sessionStorage.removeItem("admin_token");
				setAdminToken(null);
				setIsAuthenticated(false);
				return;
			}

			const data = await res.json();
			if (data.tables) {
				setTables(data.tables);
			}
		} catch {
			console.error("Failed to fetch tables");
		}
	};

	const fetchTableInfo = async (table: string) => {
		try {
			const res = await fetch(`${API_BASE}/api/admin/table-info/${table}`, {
				headers: { Authorization: `Bearer ${adminToken}` },
			});
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

				const res = await fetch(`${API_BASE}/api/admin/tables/${table}?${params}`, {
					headers: { Authorization: `Bearer ${adminToken}` },
				});
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
		[adminToken, pagination.page, pagination.limit, sortBy, sortOrder, searchQuery]
	);

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

	const handleSaveEdit = async () => {
		if (!selectedTable || !editingRow) return;
		setActionError("");
		setIsLoading(true);

		try {
			const rowId = editingRow[primaryKey];
			const res = await fetch(`${API_BASE}/api/admin/tables/${selectedTable}/${rowId}`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${adminToken}`,
				},
				body: JSON.stringify(editedData),
			});

			const data = await res.json();
			if (!res.ok) {
				setActionError(data.error || "Failed to update row");
				return;
			}

			setActionSuccess("Row updated successfully");
			setEditingRow(null);
			setEditedData({});
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
			const res = await fetch(`${API_BASE}/api/admin/tables/${selectedTable}/${rowId}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${adminToken}` },
			});

			const data = await res.json();
			if (!res.ok) {
				setActionError(data.error || "Failed to delete row");
				return;
			}

			setActionSuccess("Row deleted successfully");
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
			const res = await fetch(`${API_BASE}/api/admin/tables/${selectedTable}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${adminToken}`,
				},
				body: JSON.stringify(newRowData),
			});

			const data = await res.json();
			if (!res.ok) {
				setActionError(data.error || "Failed to insert row");
				return;
			}

			setActionSuccess(`Row inserted successfully (ID: ${data.insertId})`);
			setIsAddingRow(false);
			setNewRowData({});
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

	const formatCellValue = (value: unknown): string => {
		if (value === null || value === undefined) return "NULL";
		if (typeof value === "object") {
			if (value instanceof Date) return value.toISOString();
			return JSON.stringify(value);
		}
		return String(value);
	};

	const renderCellInput = (column: Column, value: unknown, isNew = false) => {
		const strValue = value === null || value === undefined ? "" : String(value);

		if (column.isAutoIncrement && !isNew) {
			return <span className="readonly-value">{strValue}</span>;
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
						<h1>🔐 Admin Panel</h1>
						<p>Filspresso Database Management</p>
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
							<input
								id="password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Admin password"
								autoComplete="current-password"
								required
							/>
						</div>
						{loginError && <div className="error-message">{loginError}</div>}
						<button type="submit" className="login-button" disabled={isLoading}>
							{isLoading ? "Logging in..." : "Login"}
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
					<h1>🛠️ Filspresso Admin</h1>
					<span className="admin-subtitle">Database Management</span>
				</div>
				<div className="admin-header-right">
					<span className="admin-user">👤 Admin</span>
					<button onClick={handleLogout} className="logout-button">
						Logout
					</button>
				</div>
			</header>

			<div className="admin-main">
				{/* Sidebar - Table List */}
				<aside className="admin-sidebar">
					<h2>📊 Tables</h2>
					<ul className="table-list">
						{tables.map((table) => (
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
				</aside>

				{/* Main Content */}
				<main className="admin-content">
					{!selectedTable ? (
						<div className="no-table-selected">
							<div className="empty-state">
								<span className="empty-icon">📋</span>
								<h2>Select a Table</h2>
								<p>Choose a table from the sidebar to view and manage its data</p>
							</div>
						</div>
					) : (
						<>
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
											🔍
										</button>
									</form>
									<button onClick={handleAddRow} className="add-row-button">
										➕ Add Row
									</button>
									<button onClick={() => fetchTableData(selectedTable)} className="refresh-button">
										🔄 Refresh
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
											💾 Save
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
											{columns.map((column) => (
												<th
													key={column.name}
													onClick={() => handleSort(column.name)}
													className={`sortable ${sortBy === column.name ? "sorted" : ""}`}
												>
													{column.name}
													{column.isPrimary && <span className="pk-badge">PK</span>}
													{sortBy === column.name && (
														<span className="sort-indicator">{sortOrder === "asc" ? "▲" : "▼"}</span>
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
																💾
															</button>
															<button
																onClick={handleCancelEdit}
																className="action-btn cancel"
																title="Cancel"
															>
																❌
															</button>
														</>
													) : (
														<>
															<button
																onClick={() => handleEditRow(row)}
																className="action-btn edit"
																title="Edit"
															>
																✏️
															</button>
															<button
																onClick={() => handleDeleteRow(row)}
																className="action-btn delete"
																title="Delete"
															>
																🗑️
															</button>
														</>
													)}
												</td>
												{columns.map((column) => (
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
										⏮️
									</button>
									<button
										onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
										disabled={pagination.page === 1}
										className="page-btn"
									>
										◀️
									</button>
									<span className="page-info">
										Page {pagination.page} of {pagination.totalPages}
									</span>
									<button
										onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
										disabled={pagination.page === pagination.totalPages}
										className="page-btn"
									>
										▶️
									</button>
									<button
										onClick={() => setPagination((p) => ({ ...p, page: p.totalPages }))}
										disabled={pagination.page === pagination.totalPages}
										className="page-btn"
									>
										⏭️
									</button>
								</div>
							)}

							{/* Column Info */}
							<details className="column-info">
								<summary>📋 Column Schema</summary>
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
						</>
					)}
				</main>
			</div>
		</div>
	);
}
