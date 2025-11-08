"use client";
import React, { useEffect, useRef, useState } from "react";

// Import from the installed package; it will be bundled for client use.
// Note: MediaPipe Tasks GenAI requires a WebGPU-capable browser.
import { FilesetResolver, LlmInference } from "@mediapipe/tasks-genai";

export default function VillanelleClient() {
	const [llm, setLlm] = useState<any>(null);
	const [ready, setReady] = useState(false);
	const [prompt, setPrompt] = useState("Write a friendly coffee tip in 2 sentences.");
	const [output, setOutput] = useState("");
	const streamingRef = useRef(false);

	useEffect(() => {
		let mounted = true;

		async function init() {
			try {
				// Load wasm fileset from CDN and create the llm inference instance.
				const genai = await FilesetResolver.forGenAiTasks(
					"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm"
				);

				const instance = await LlmInference.createFromOptions(genai, {
					baseOptions: {
						// Use the API route that serves the binary kept in python_ai/models
						modelAssetPath: "/api/model/gemma3-1b-it-int4-web.task",
					},
					maxTokens: 512,
					topK: 40,
					temperature: 0.8,
				});

				if (!mounted) return;
				setLlm(instance);
				setReady(true);
			} catch (e) {
				console.error("Failed to initialize LLM Inference:", e);
				setReady(false);
			}
		}

		init();

		return () => {
			mounted = false;
			// Dispose the instance if it exists
			if (llm && llm.close) llm.close();
		};
	}, []);

	const handleGenerate = async () => {
		if (!llm || streamingRef.current) return;
		setOutput("");
		streamingRef.current = true;

		try {
			await llm.generateResponse(prompt, (partialResult: string, done: boolean) => {
				setOutput((s) => s + partialResult);
				if (done) streamingRef.current = false;
			});
		} catch (e) {
			console.error("Inference error", e);
			streamingRef.current = false;
		}
	};

	return (
		<div style={{ padding: 20 }}>
			<h2>Villanelle (on-device) — Gemma-3n (via Tasks GenAI)</h2>
			{!ready && <p>Initializing model (WebGPU required). If this hangs, use a WebGPU-enabled browser.</p>}

			<textarea
				value={prompt}
				onChange={(e) => setPrompt(e.target.value)}
				rows={4}
				style={{ width: "100%", marginBottom: 8 }}
			/>

			<div style={{ display: "flex", gap: 8 }}>
				<button onClick={handleGenerate} disabled={!ready}>
					Generate
				</button>
				<button
					onClick={() => {
						setPrompt("");
						setOutput("");
					}}
				>
					Clear
				</button>
			</div>

			<h3>Output</h3>
			<pre style={{ whiteSpace: "pre-wrap", background: "#f7f7f7", padding: 12 }}>{output}</pre>
		</div>
	);
}
