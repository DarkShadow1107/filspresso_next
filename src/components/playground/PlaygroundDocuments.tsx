"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteDocument, downloadDocument, listDocuments, type PlaygroundDocumentRef } from "@/lib/playgroundDocuments";
import WorkspaceIcon from "./WorkspaceIcon";

/**
 * The account's server-saved documents, as the Settings view sees them.
 *
 * Everything here is fail-open: an unavailable backend shows an empty note, an unavailable
 * download shows an inline error, and every row's download goes through the user's own
 * session, so a file that would not download is at worst an inconvenience — never a leak.
 */
export default function PlaygroundDocumentsManager({ streaming }: { streaming?: boolean }) {
	const [documents, setDocuments] = useState<PlaygroundDocumentRef[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [notice, setNotice] = useState("");
	const [busyId, setBusyId] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const rows = await listDocuments();
		setDocuments(rows);
		setLoaded(true);
	}, []);

	useEffect(() => {
		let active = true;
		void listDocuments().then(rows => {
			if (!active) return;
			setDocuments(rows);
			setLoaded(true);
		});
		return () => { active = false; };
	}, []);

	const formatBytes = (bytes: number) => {
		if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
		if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
		return `${bytes} B`;
	};
	const formatDate = (value: string) => {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString();
	};

	const download = async (row: PlaygroundDocumentRef) => {
		setBusyId(row.id);
		setNotice("");
		try {
			const failure = await downloadDocument(row.id, row.name);
			if (failure) setNotice(failure);
		} finally { setBusyId(null); }
	};

	const remove = async (row: PlaygroundDocumentRef) => {
		setBusyId(row.id);
		setNotice("");
		try {
			const removed = await deleteDocument(row.id);
			if (removed) setDocuments(previous => previous.filter(item => item.id !== row.id));
			else setNotice("This document could not be deleted. Please retry.");
		} finally { setBusyId(null); }
	};

	return (
		<div className="pgw-documents">
			<div className="pgw-documents-head">
				<p className="pgw-sidebar-caption">Saved on the server · delete a document to free space if storage is full</p>
				<button type="button" className="pgw-text-button" disabled={streaming || busyId !== null} onClick={() => void refresh()}>Refresh</button>
			</div>
			{loaded && !documents.length && <p className="pgw-sidebar-note">No documents yet. In chat, answers left in a document file appear here and in the conversation.</p>}
			<div className="pgw-document-list">
				{documents.map((row) => (
					<div className="pgw-document-row" key={row.id}>
						<div className="pgw-document-meta">
							<span className="pgw-document-name"><WorkspaceIcon name="file" width={14} height={14} /> {row.name}</span>
							<span className="pgw-document-sub">{formatBytes(row.contentBytes)}{formatDate(row.createdAt) && ` · ${formatDate(row.createdAt)}`}</span>
						</div>
						<div className="pgw-document-actions">
							<button type="button" className="pgw-text-button" disabled={busyId === row.id} aria-label={`Download document: ${row.name}`} onClick={() => void download(row)}><WorkspaceIcon name="download" width={14} height={14} /> Download</button>
							<button type="button" className="pgw-text-button" disabled={busyId === row.id} aria-label={`Delete document: ${row.name}`} onClick={() => void remove(row)}><WorkspaceIcon name="trash" width={14} height={14} /> Delete</button>
						</div>
					</div>
				))}
			</div>
			{notice && <p className="pgw-notice" role="alert">{notice}</p>}
		</div>
	);
}
