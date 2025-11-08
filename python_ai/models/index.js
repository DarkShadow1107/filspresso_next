import { FilesetResolver, LlmInference } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.25";

const statusEl = document.getElementById("status");
const promptEl = document.getElementById("prompt");
const outputEl = document.getElementById("output");
const generateBtn = document.getElementById("generate");
const clearBtn = document.getElementById("clear");

let inference = null;
let streaming = false;

async function init() {
	statusEl.textContent = "Downloading MediaPipe WASM files…";
	try {
		const fileset = await FilesetResolver.forGenAiTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.25/wasm");

		inference = await LlmInference.createFromOptions(fileset, {
			baseOptions: {
				modelAssetPath: "./gemma3-1b-it-int4-web.task",
			},
			maxTokens: 256,
			topK: 40,
			temperature: 0.8,
		});

		statusEl.textContent = "Model ready. Enter a prompt and press Generate.";
		generateBtn.disabled = false;
	} catch (error) {
		console.error("Failed to initialize MediaPipe Tasks GenAI", error);
		statusEl.textContent = "Initialization failed. Check the console and ensure WebGPU is enabled.";
	}
}

async function runInference() {
	if (!inference || streaming) {
		return;
	}

	const prompt = promptEl.value.trim();
	if (!prompt) {
		statusEl.textContent = "Please enter a prompt before generating.";
		return;
	}

	outputEl.textContent = "";
	streaming = true;
	generateBtn.disabled = true;
	statusEl.textContent = "Running on-device inference…";

	try {
		await inference.generateResponse(prompt, (partial, done) => {
			outputEl.textContent += partial;
			if (done) {
				streaming = false;
				generateBtn.disabled = false;
				statusEl.textContent = "Generation complete.";
			}
		});
	} catch (error) {
		console.error("Inference error", error);
		statusEl.textContent = "Inference failed. See console for details.";
		streaming = false;
		generateBtn.disabled = false;
	}
}

function clearOutput() {
	if (!streaming) {
		outputEl.textContent = "";
	}
}

generateBtn.addEventListener("click", runInference);
clearBtn.addEventListener("click", () => {
	clearOutput();
	promptEl.focus();
});

init();
