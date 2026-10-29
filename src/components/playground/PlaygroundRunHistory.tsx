"use client";

import * as React from "react";
import { listRecordedRuns, recordedRunLabel, recordedRunLocation, recordedRunOutcome, replayPayloadDisplay, replayRecordedRun, type RecordedRun, type RecordedRunEvent, type RunReplayPage } from "@/lib/playgroundRuns";
import WorkspaceIcon from "./WorkspaceIcon";
import WorkspacePicker from "./WorkspacePicker";

/** Recorded payloads are inert text, never Markdown, HTML, tool calls or executable commands. */
export function RecordedEventCard({ event }: { event: RecordedRunEvent }) {
	const payload = replayPayloadDisplay(event.payload);
	return <li className="pgw-recorded-event">
		<h3>#{event.sequence} · {event.kind}</h3>
		<p>{event.createdAt} · v{event.version} · Record status: {event.status}</p>
		{event.version !== 1 && <p role="status">Unknown event version; shown as data only.</p>}
		{(event.kind === "run.truncated" || payload.clipped) && <p className="pgw-notice">Recorded output or this display was clipped. This is not a complete log.</p>}
		<pre>{payload.text}</pre>
	</li>;
}

function ReplayEvents({ runId, afterSequence, onPage }: { runId: string; afterSequence: number; onPage: (cursor: number) => void }) {
	const [page, setPage] = React.useState<RunReplayPage | null>(null);
	const [error, setError] = React.useState("");
	React.useEffect(() => {
		const controller = new AbortController();
		void replayRecordedRun(runId, afterSequence, controller.signal).then(result => { if (!controller.signal.aborted) setPage(result); })
			.catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Replay is unavailable. Please retry."); });
		return () => controller.abort();
	}, [runId, afterSequence]);
	return <>
		{!page && !error && <p role="status">Loading recorded events…</p>}
		{error && <p role="alert">{error} Use Refresh activity to retry.</p>}
		{page && <>
			{!page.events.length && <p>No events remain for this run. They may have expired or been deleted.</p>}
			<ol className="pgw-recorded-events" aria-label="Recorded run events">{page.events.map(event => <RecordedEventCard key={event.sequence} event={event} />)}</ol>
			<div className="pgw-history-actions">
				{afterSequence >= 0 && <button type="button" className="pgw-text-button" onClick={() => onPage(-1)}>Back to first events</button>}
				{page.hasMore && <button type="button" className="pgw-outlined-button" onClick={() => onPage(page.nextAfterSequence!)}>Next recorded events</button>}
			</div>
		</>}
	</>;
}

function HistoryResults({ sessionUuid }: { sessionUuid?: string }) {
	const [runs, setRuns] = React.useState<RecordedRun[] | null>(null);
	const [error, setError] = React.useState("");
	const [selected, setSelected] = React.useState<RecordedRun | null>(null);
	const [afterSequence, setAfterSequence] = React.useState(-1);
	React.useEffect(() => {
		const controller = new AbortController();
		void listRecordedRuns(sessionUuid, controller.signal).then(result => { if (!controller.signal.aborted) setRuns(result); })
			.catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Activity is unavailable. Please retry."); });
		return () => controller.abort();
	}, [sessionUuid]);
	return <>
		{!runs && !error && <p role="status">Loading recorded activity…</p>}
		{error && <div className="pgw-empty-state" role="alert"><WorkspaceIcon name="help" width={30} /><h2>Activity unavailable</h2><p>{error}</p></div>}
		{runs?.length === 0 && <div className="pgw-empty-state"><WorkspaceIcon name="file" width={32} /><h2>No retained activity</h2><p>{sessionUuid ? "No runs are linked to this conversation." : "Recorded runs will appear here."} Logs can expire; an empty list does not prove no work happened.</p></div>}
		<div className="pgw-history-layout">
			<nav aria-label="Recent recorded runs">{runs?.map(run => <button type="button" key={run.runId} aria-current={selected?.runId === run.runId ? "true" : undefined}
				onClick={() => { setSelected(run); setAfterSequence(-1); }}>
				<b>{recordedRunLabel(run.runId)}</b><span>{recordedRunOutcome(run.outcome)}</span><small>{run.updatedAt} · {run.eventCount} records</small><code>{run.runId}</code>
			</button>)}</nav>
			<section aria-label="Selected run replay">
				{!selected && !!runs?.length && <p>Choose a run to inspect its recorded events.</p>}
				{selected && <>
					<h2>{recordedRunLabel(selected.runId)} · {recordedRunOutcome(selected.outcome)}</h2>
					<p>{recordedRunLocation(selected.runId)}</p><p>{selected.model || "No model recorded"} · {selected.sessionUuid ? "Linked to a saved conversation" : "Not linked to a saved conversation"}</p>
					{selected.settlementFailed && <p role="status">A settlement failure was recorded. Completion is not proof of a successful charge.</p>}
					{selected.truncated && <p className="pgw-notice">Output was truncated. Later completion/settlement events may be on another page.</p>}
					<ReplayEvents key={`${selected.runId}:${afterSequence}`} runId={selected.runId} afterSequence={afterSequence} onPage={setAfterSequence} />
				</>}
			</section>
		</div>
	</>;
}

export default function PlaygroundRunHistory({ sessionUuid }: { sessionUuid?: string }) {
	const [onlyConversation, setOnlyConversation] = React.useState(false);
	const [revision, setRevision] = React.useState(0);
	const filter = onlyConversation && sessionUuid ? sessionUuid : undefined;
	return <section className="pgw-run-history" aria-label="Recorded activity">
		<div className="pgw-section-heading"><WorkspaceIcon name="file" width={26} /><div><span className="pgw-eyebrow">History</span><h1>Activity</h1><p>Recent runs and their recorded events. Read-only, never a rerun.</p></div><button type="button" className="pgw-outlined-button" onClick={() => setRevision(value => value + 1)}><WorkspaceIcon name="retry" width={15} />Refresh activity</button></div>
		<div className="pgw-activity-filters"><WorkspacePicker label="Activity scope" value={filter ? "conversation" : "account"} icon={null} options={[{ key: "account", label: "All activity" }, ...(sessionUuid ? [{ key: "conversation", label: "This conversation" }] : [])]} onChange={value => setOnlyConversation(value === "conversation")} /><span>Latest 20 runs</span></div>
		<HistoryResults key={`${filter || "account"}:${revision}`} sessionUuid={filter} />
		<details className="pgw-advanced"><summary>About these records</summary><p>Not a conversation transcript. Logs are bounded and may expire or be deleted. No completion record does not mean a job is still running. All activity includes first generations and hosted workspace events not linked to a saved conversation.</p></details>
	</section>;
}
