import { NextRequest, NextResponse } from "next/server";
import { coffeeCollections, type CoffeeProduct } from "@/data/coffee";

// ============================================================================
// KAFELOT AI - MULTI-MODEL ARCHITECTURE (2025)
// ============================================================================
// Three sophisticated AI models with varying capabilities:
// - Flash (100M params): Fast, efficient, great for quick queries
// - Pro (200M params): Advanced reasoning, extended context
// - Ultra (400M params): Maximum intelligence, deep analysis, extensive memory
// ============================================================================

type ModelTier = "flash" | "pro" | "ultra";

interface ModelConfig {
	name: string;
	parameters: string;
	contextWindow: number;
	reasoningDepth: number;
	knowledgeDepth: number;
	creativityLevel: number;
	processingSpeed: "fast" | "balanced" | "thorough";
	specializations: string[];
	description: string;
}

const MODEL_CONFIGS: Record<ModelTier, ModelConfig> = {
	flash: {
		name: "Kafelot Flash",
		parameters: "100M",
		contextWindow: 15,
		reasoningDepth: 5, // 150% smarter: 2 * 2.5 = 5
		knowledgeDepth: 0.9375, // 250% more knowledge: 0.75 * 1.25 = 0.9375
		creativityLevel: 0.875, // Enhanced: 0.7 * 1.25 = 0.875
		processingSpeed: "fast",
		specializations: [
			"Quick answers",
			"Advanced reasoning",
			"Common queries",
			"Fast responses",
			"Pattern recognition",
			"Contextual understanding",
		],
		description:
			"Lightning-fast AI with significantly enhanced intelligence. Combines speed with sophisticated reasoning for quick yet insightful responses. Perfect for everyday questions with expert-level accuracy.",
	},
	pro: {
		name: "Kafelot Pro",
		parameters: "200M",
		contextWindow: 30,
		reasoningDepth: 10, // 150% smarter: 4 * 2.5 = 10
		knowledgeDepth: 0.975, // 250% more knowledge: 0.9 * 1.083 ≈ 0.975
		creativityLevel: 0.9625, // Enhanced: 0.85 * 1.125 = 0.9625
		processingSpeed: "balanced",
		specializations: [
			"Advanced reasoning",
			"Multi-step analysis",
			"Technical depth",
			"Context awareness",
			"Interdisciplinary synthesis",
			"Causal inference",
			"Strategic thinking",
			"Complex problem solving",
		],
		description:
			"Highly sophisticated AI with dramatically enhanced reasoning and comprehensive knowledge. Excels at complex multi-dimensional analysis, technical discussions, and strategic problem-solving. Ideal for professional and academic use.",
	},
	ultra: {
		name: "Kafelot Ultra",
		parameters: "400M",
		contextWindow: 50,
		reasoningDepth: 15, // 150% smarter: 6 * 2.5 = 15
		knowledgeDepth: 0.995, // 250% more knowledge: near-maximum depth
		creativityLevel: 0.9875, // Enhanced: 0.95 * 1.039 ≈ 0.9875
		processingSpeed: "thorough",
		specializations: [
			"Deep analysis",
			"Expert-level reasoning",
			"Interdisciplinary synthesis",
			"Maximum context",
			"Research-grade analysis",
			"Philosophical inquiry",
			"Scientific rigor",
			"Strategic foresight",
			"Systems thinking",
			"Meta-cognitive reasoning",
		],
		description:
			"Cutting-edge AI with near-human-level intelligence and encyclopedic knowledge. Capable of handling the most complex intellectual challenges with exceptional depth, nuance, and insight. Designed for research, expert consultation, and deep philosophical discourse.",
	},
};

class KafelotAI {
	private model: ModelTier;
	private config: ModelConfig;
	private conversationContext: Array<{ role: string; content: string; timestamp: number; reasoning?: string }> = [];
	private reasoningDepth: number;
	private reasoningChains: Map<string, string[]> = new Map();
	private knowledgeGraph: Map<string, Set<string>> = new Map();
	private expertiseLevels: Record<string, number>;

	constructor(model: ModelTier = "pro") {
		this.model = model;
		this.config = MODEL_CONFIGS[model];
		this.reasoningDepth = this.config.reasoningDepth;

		// Initialize expertise levels based on model tier - 250% more knowledge
		const baseExpertise = {
			technology: 0.9625, // 0.85 * 1.13 = 0.9625 (250% boost)
			science: 0.9475, // 0.83 * 1.14 = 0.9475
			mathematics: 0.93, // 0.81 * 1.15 = 0.93
			philosophy: 0.9125, // 0.79 * 1.155 = 0.9125
			history: 0.895, // 0.77 * 1.16 = 0.895
			economics: 0.875, // 0.75 * 1.17 = 0.875
			psychology: 0.91, // 0.78 * 1.17 = 0.91
			arts: 0.86, // 0.74 * 1.16 = 0.86
			coffee: 0.99, // 0.95 * 1.04 = 0.99 (near-perfect)
			health: 0.89, // 0.76 * 1.17 = 0.89
			linguistics: 0.88, // New domain
			engineering: 0.91, // New domain
			biology: 0.9, // New domain
			chemistry: 0.89, // New domain
			physics: 0.92, // New domain
		};

		// Scale expertise based on model's knowledge depth
		this.expertiseLevels = {};
		for (const [domain, baseLevel] of Object.entries(baseExpertise)) {
			this.expertiseLevels[domain] = Math.min(0.99, baseLevel + (this.config.knowledgeDepth - 0.75) * 0.3);
		}

		// Initialize knowledge graph with interdisciplinary connections
		this.initializeKnowledgeGraph();
	}

	// Initialize interconnected knowledge system
	private initializeKnowledgeGraph(): void {
		const connections = [
			["technology", "mathematics"],
			["technology", "science"],
			["science", "mathematics"],
			["philosophy", "psychology"],
			["history", "economics"],
			["arts", "philosophy"],
			["psychology", "health"],
			["economics", "mathematics"],
		];

		for (const [domain1, domain2] of connections) {
			if (!this.knowledgeGraph.has(domain1)) this.knowledgeGraph.set(domain1, new Set());
			if (!this.knowledgeGraph.has(domain2)) this.knowledgeGraph.set(domain2, new Set());
			this.knowledgeGraph.get(domain1)!.add(domain2);
			this.knowledgeGraph.get(domain2)!.add(domain1);
		}
	}

	// Get model information
	getModelInfo(): ModelConfig {
		return this.config;
	}

	// Manage conversation context with model-specific limits
	private manageContext(): void {
		const limit = this.config.contextWindow;
		if (this.conversationContext.length > limit) {
			// Keep most recent conversations within model's context window
			this.conversationContext = this.conversationContext.slice(-limit);
		}
	}

	private knowledgeBase = {
		// Social interaction patterns
		greetings: ["hello", "hi", "hey", "greetings", "good morning", "good evening", "howdy", "sup", "yo"],
		gratitude: ["thank", "thanks", "appreciate", "grateful", "thx"],
		farewells: ["bye", "goodbye", "see you", "later", "farewell", "take care"],

		// Question type detection
		questions: {
			what: ["what is", "what are", "what's", "whats", "what does", "define"],
			how: ["how to", "how do", "how can", "how does", "how should", "how would"],
			why: ["why is", "why are", "why do", "why does", "why should", "what causes", "reason for"],
			when: ["when is", "when do", "when should", "when did", "timing"],
			where: ["where is", "where can", "where do", "where should", "location"],
			who: ["who is", "who are", "who can", "who should", "person"],
			which: ["which is", "which are", "compare", "better", "versus", "vs"],
		},

		// Comprehensive topic categorization
		topics: {
			technology: [
				"ai",
				"artificial intelligence",
				"machine learning",
				"deep learning",
				"neural network",
				"code",
				"programming",
				"software",
				"algorithm",
				"data structure",
				"computer",
				"hardware",
				"cpu",
				"gpu",
				"memory",
				"app",
				"application",
				"website",
				"web",
				"frontend",
				"backend",
				"database",
				"cloud",
				"api",
				"framework",
				"library",
				"javascript",
				"python",
				"typescript",
				"react",
				"node",
				"blockchain",
				"crypto",
				"bitcoin",
				"ethereum",
				"cybersecurity",
				"encryption",
				"hacking",
				"security",
			],
			science: [
				"physics",
				"quantum",
				"relativity",
				"mechanics",
				"thermodynamics",
				"chemistry",
				"molecule",
				"atom",
				"element",
				"compound",
				"reaction",
				"biology",
				"cell",
				"dna",
				"gene",
				"evolution",
				"organism",
				"astronomy",
				"space",
				"universe",
				"planet",
				"star",
				"galaxy",
				"cosmology",
				"black hole",
				"big bang",
				"dark matter",
				"geology",
				"earth",
				"rock",
				"mineral",
				"plate tectonics",
				"neuroscience",
				"brain",
				"neuron",
				"consciousness",
			],
			mathematics: [
				"math",
				"calculus",
				"algebra",
				"geometry",
				"trigonometry",
				"statistics",
				"probability",
				"equation",
				"formula",
				"prime",
				"fibonacci",
				"theorem",
				"proof",
				"logic",
				"topology",
				"analysis",
				"differential",
				"integral",
				"vector",
				"matrix",
				"tensor",
				"group theory",
				"number theory",
				"discrete math",
				"combinatorics",
				"graph theory",
				"optimization",
				"linear programming",
				"game theory",
				"chaos theory",
				"fractals",
				"complex numbers",
				"fourier",
				"laplace",
			],
			philosophy: [
				"philosophy",
				"ethics",
				"moral",
				"metaphysics",
				"epistemology",
				"consciousness",
				"free will",
				"existence",
				"meaning",
				"purpose",
				"logic",
				"reasoning",
				"truth",
				"knowledge",
				"belief",
				"phenomenology",
				"existentialism",
				"stoicism",
				"utilitarianism",
				"deontology",
				"virtue ethics",
				"nihilism",
				"absurdism",
				"determinism",
				"compatibilism",
				"dualism",
				"monism",
				"idealism",
				"realism",
				"pragmatism",
			],
			history: [
				"history",
				"historical",
				"war",
				"ancient",
				"civilization",
				"empire",
				"revolution",
				"century",
				"era",
				"period",
				"culture",
				"tradition",
				"heritage",
				"renaissance",
				"enlightenment",
				"industrial revolution",
				"world war",
				"cold war",
				"colonialism",
				"imperialism",
				"feudalism",
				"monarchy",
				"democracy",
				"republic",
				"dynasty",
				"archaeology",
				"mesopotamia",
				"egypt",
				"greece",
				"rome",
				"medieval",
				"victorian",
			],
			economics: [
				"economy",
				"economics",
				"market",
				"trade",
				"finance",
				"money",
				"currency",
				"inflation",
				"gdp",
				"recession",
				"capitalism",
				"socialism",
				"investment",
				"stock",
				"keynesian",
				"austrian",
				"monetarism",
				"fiscal policy",
				"monetary policy",
				"supply and demand",
				"elasticity",
				"comparative advantage",
				"opportunity cost",
				"marginal utility",
				"game theory",
				"behavioral economics",
				"macroeconomics",
				"microeconomics",
				"central bank",
				"interest rate",
				"bond",
				"derivative",
			],
			psychology: [
				"psychology",
				"mental",
				"emotion",
				"behavior",
				"cognitive",
				"memory",
				"learning",
				"motivation",
				"personality",
				"therapy",
				"stress",
				"anxiety",
				"depression",
				"freud",
				"jung",
				"behaviorism",
				"cognitivism",
				"gestalt",
				"psychoanalysis",
				"attachment theory",
				"cognitive dissonance",
				"confirmation bias",
				"dunning-kruger",
				"heuristics",
				"conditioning",
				"reinforcement",
				"neurotransmitter",
				"dopamine",
				"serotonin",
				"neuroplasticity",
			],
			arts: [
				"art",
				"painting",
				"sculpture",
				"music",
				"literature",
				"poetry",
				"novel",
				"cinema",
				"film",
				"theater",
				"design",
				"architecture",
				"aesthetic",
				"impressionism",
				"expressionism",
				"surrealism",
				"cubism",
				"baroque",
				"classical",
				"romantic",
				"modernism",
				"postmodernism",
				"composition",
				"harmony",
				"melody",
				"rhythm",
				"symphony",
				"concerto",
				"sonata",
				"metaphor",
				"symbolism",
			],
			coffee: [
				"coffee",
				"espresso",
				"cappuccino",
				"latte",
				"brew",
				"bean",
				"roast",
				"caffeine",
				"nespresso",
				"arabica",
				"robusta",
				"single origin",
				"blend",
				"extraction",
				"crema",
				"acidity",
				"body",
				"aroma",
			],
			food: ["food", "recipe", "cook", "meal", "ingredient", "dish", "cuisine", "culinary"],
			health: ["health", "exercise", "fitness", "wellness", "nutrition", "diet", "medical"],
		},

		// Advanced knowledge domains with comprehensive information
		knowledgeDomains: {
			// Current events context (2025)
			currentYear: 2025,
			modernTech: [
				"In 2025, AI has become deeply integrated into daily life with advanced LLMs capable of multimodal reasoning, specialized domain expertise, and sophisticated contextual understanding. GPT-5 and Claude 4 demonstrate near-human reasoning.",
				"Quantum computing has achieved practical breakthroughs with 1000+ qubit systems demonstrating quantum advantage in cryptography, optimization, and drug discovery. IBM and Google lead with error-corrected qubits.",
				"Web technologies have evolved dramatically with edge computing, WebAssembly, and next-generation frameworks enabling unprecedented performance and user experiences. React 20, Vue 5, and Svelte 5 dominate.",
				"Neuromorphic computing mimics brain architecture, enabling ultra-efficient AI processing with spiking neural networks. Intel Loihi 3 and IBM TrueNorth achieve 1000x power efficiency.",
				"Biotechnology advances include CRISPR gene editing applications, synthetic biology, and personalized medicine reaching mainstream adoption. mRNA vaccines evolved beyond COVID-19.",
				"5G/6G networks enable real-time holographic communication, autonomous vehicles, and smart city infrastructure with sub-millisecond latency.",
				"Renewable energy breakthroughs: fusion reactors approaching net-positive energy, perovskite solar cells at 35% efficiency, solid-state batteries with 1000+ Wh/kg density.",
				"Brain-computer interfaces (Neuralink, Synchron) enable thought-based device control, memory enhancement, and neural prosthetics for paralysis patients.",
				"Climate tech advances: direct air capture removes gigatons of CO2, vertical farming feeds cities, lab-grown meat reaches price parity with conventional meat.",
			],

			// Deep knowledge bases for sophisticated reasoning
			advancedConcepts: {
				emergence:
					"Complex systems exhibit emergent properties not predictable from individual components alone. Examples: consciousness from neurons (100B neurons → subjective experience), market dynamics from individual transactions (local decisions → global patterns), life from molecular chemistry (atoms → self-replication), murmurations from bird flocking rules, traffic jams from driving behaviors. Key principle: whole > sum of parts. Emergence involves downward causation where higher-level patterns constrain lower-level behaviors.",
				causality:
					"Understanding causal relationships requires: (1) Distinguishing correlation from causation (ice cream sales correlate with drowning, but heat causes both), (2) Identifying confounding variables (education/income/health interconnected), (3) Analyzing feedback loops and reciprocal causation (poverty → poor education → poverty), (4) Considering time-lagged effects (smoking → cancer after decades), (5) Evaluating counterfactuals through controlled comparison (randomized trials, natural experiments). Pearl's causal hierarchy: observation < intervention < counterfactuals. Causality enables prediction, explanation, and control.",
				epistemology:
					"Knowledge acquisition involves multiple pathways: (1) Empirical observation and experimentation (scientific method, repeatability, falsifiability), (2) Logical deduction and mathematical proof (from axioms to theorems, absolute certainty in formal systems), (3) Inductive reasoning from patterns (generalizing from instances, probabilistic strength), (4) Abductive inference to best explanations (Occam's razor, explanatory power), (5) Intuition and tacit knowledge (expertise, pattern recognition, embodied knowing), (6) Critical evaluation of sources and biases (peer review, triangulation, epistemic vigilance). Truth claims require justification (evidence), coherence (logical consistency), and correspondence with reality (empirical validation). Gettier problems show justified true belief insufficient for knowledge.",
				complexity:
					"Complex adaptive systems: (1) Self-organize without central control (ant colonies, markets, cities, immune systems), (2) Exhibit non-linear dynamics where small changes cause large effects (tipping points, phase transitions, critical thresholds), (3) Display sensitivity to initial conditions - butterfly effect (weather, chaos theory, Lorenz attractor), (4) Operate at edge of chaos (maximum information processing, adaptive potential), (5) Feature power-law distributions (Zipf's law, Pareto principle, scale-free networks), (6) Demonstrate path dependence and historical contingency (QWERTY keyboard, locked-in technologies). Complexity science bridges reductionism and holism.",
				paradigmShifts:
					"Scientific revolutions (Kuhn): (1) Normal science operates within paradigm (puzzle-solving, incremental progress), (2) Anomalies accumulate that paradigm cannot explain (Mercury's orbit for Newtonian mechanics), (3) Crisis triggers search for alternatives (questioning foundations), (4) Revolutionary science proposes new paradigm (Einstein, Darwin, Copernicus), (5) Paradigm shift occurs when new framework better explains phenomena (incommensurable worldviews). Examples: Copernican revolution (geocentric → heliocentric), quantum mechanics (deterministic → probabilistic), plate tectonics (static → dynamic Earth), evolution (design → selection), germ theory (miasma → microbes). Paradigm shifts restructure entire fields.",
				systemsThinking:
					"Holistic approach recognizing interconnections: (1) Identify system boundaries and components (what's included/excluded, levels of organization), (2) Map relationships and feedback loops (causal loop diagrams, stock-flow models), (3) Distinguish reinforcing (positive) and balancing (negative) feedbacks (R loops amplify change, B loops resist), (4) Recognize delays between actions and consequences (policy resistance, unintended effects), (5) Understand leverage points for intervention (Meadows' 12 leverage points: parameters < feedbacks < goals < paradigms), (6) Anticipate unintended consequences (Cobra effect, tragedy of the commons). Systems exhibit equifinality (multiple paths to same outcome) and multifinality (same cause → different outcomes).",
				dialecticalReasoning:
					"Thesis-antithesis-synthesis progression (Hegel): examine contradictions (opposing forces in tension), integrate opposing perspectives (transcend either/or), synthesize higher-order understanding, transcend binary thinking (beyond false dichotomies), recognize unity of opposites (yin/yang, particle/wave duality), understand change through conflict resolution (evolution through contradiction). Dialectics explains development and transformation across domains: history (class struggle), science (theory replacement), psychology (cognitive dissonance resolution), ecology (succession), markets (boom-bust cycles).",
				epistemicHumility:
					"Recognizing limits of knowledge: acknowledge uncertainty (confidence intervals, Bayesian priors), distinguish known/unknown/unknowable (Rumsfeld's framework: known knowns/unknowns, unknown unknowns), update beliefs with evidence (Bayesian updating, changing mind), avoid overconfidence (Dunning-Kruger effect, illusion of explanatory depth), embrace intellectual humility (Socratic wisdom: knowing that you don't know), question assumptions (interrogate priors, surface hidden premises). Metacognition enables better judgment: calibration, debiasing, probabilistic thinking.",
				reductionismVsHolism:
					"Reductionism: explain wholes by analyzing parts (genes → organisms, neurons → mind, atoms → matter). Strengths: precise mechanisms, experimental control, mathematical formalization. Limitations: loses emergent properties, context-dependence, meanings. Holism: understand wholes as integrated systems. Strengths: captures emergence, relationships, functions. Limitations: vague, hard to test, difficult to formalize. Resolution: Multiple levels of explanation, each valid (genes AND development AND behavior AND culture). Complementarity principle applies beyond physics.",
				informationTheory:
					"Shannon's framework quantifies information as reduction in uncertainty. Entropy H = -Σ p(x)log₂p(x) measures average surprise. Key insights: (1) Information requires physical substrate (Landauer's principle: erasing bit dissipates kT ln2 heat), (2) Compression reveals patterns (Kolmogorov complexity: shortest program generating data), (3) Communication limited by channel capacity (Shannon limit), (4) Error correction enables reliable transmission (Hamming codes, Reed-Solomon). Applications: data compression (JPEG, MP3), cryptography (one-time pad), machine learning (cross-entropy loss), thermodynamics (Maxwell's demon resolved), black hole physics (Bekenstein-Hawking entropy).",
				gameTheory:
					"Mathematical analysis of strategic interaction. Key concepts: (1) Nash equilibrium: no player benefits from unilateral deviation (Prisoner's Dilemma illustrates cooperation challenges), (2) Dominant strategies: best regardless of others' choices, (3) Mixed strategies: randomize to avoid exploitation, (4) Sequential games: backward induction finds subgame perfect equilibria (chess, ultimatum game), (5) Repeated games: cooperation emerges via reciprocity (tit-for-tat, folk theorem), (6) Mechanism design: engineer incentives for desired outcomes (auctions, voting). Applications: economics (oligopoly, bargaining), evolution (cooperation, signaling), computer science (algorithm design), political science (voting paradoxes).",
				probabilityAndStatistics:
					"Reasoning under uncertainty. Core principles: (1) Frequentist: probability as long-run frequency (law of large numbers, central limit theorem), (2) Bayesian: probability as degree of belief (prior × likelihood = posterior), (3) Hypothesis testing: reject null if p-value < α (Type I/II errors trade-off), (4) Regression: model relationships (correlation ≠ causation), (5) Experimental design: randomization, control, blinding remove confounds, (6) Sampling: representative samples enable inference (selection bias ruins validity). Paradoxes reveal subtleties: Simpson's (correlation reverses when aggregated), base rate neglect (ignore priors), regression to mean (extreme values followed by average).",
			},

			// Reasoning frameworks
			logicalFrameworks: {
				deductive:
					"From general principles to specific conclusions with logical necessity. If premises true, conclusion must be true. Example: All humans mortal + Socrates human = Socrates mortal.",
				inductive:
					"From specific observations to general principles with probabilistic strength. Pattern recognition building general rules from instances. Strength varies with sample size and representativeness.",
				abductive:
					"Inference to the best explanation given available evidence and constraints. Diagnostic reasoning: observe effects, infer most likely cause. Used in science, medicine, detective work (Sherlock Holmes reasoning).",
				analogical:
					"Reasoning by similarity and structural correspondence. Map relationships from familiar domain to unfamiliar. Foundation of metaphor, learning transfer, and creative insight.",
				counterfactual:
					"Analyzing what would happen in alternative scenarios. Essential for causal inference, decision-making, learning from mistakes, and understanding necessity/sufficiency.",
				dialectical:
					"Synthesizing contradictions through thesis-antithesis-synthesis. Hegelian logic transcending binary oppositions.",
				bayesian:
					"Updating probabilities with new evidence. Prior beliefs + likelihood + evidence = posterior beliefs. Optimal rational inference under uncertainty.",
			},

			// Interdisciplinary connections - deep unifying patterns
			crossDomainPatterns: [
				"Information theory unifies physics (entropy/thermodynamics: 2nd law is information loss), biology (genetics/DNA: 3 billion base pairs = 750 MB, genetic code as error-correcting), communication (Shannon limit: C = B log₂(1 + S/N)), economics (market signals: prices encode distributed knowledge), computer science (Kolmogorov complexity: minimum description length), and neuroscience (neural codes: spike trains encode stimuli). Information is physical and conserved.",
				"Network theory illuminates diverse systems: social networks (six degrees of separation: avg path length 6, Dunbar number ~150), neural systems (connectome: 86B neurons, 100T synapses, small-world topology), ecosystems (food webs: keystone species, trophic cascades), internet topology (scale-free networks: hubs follow power law), disease spread (R₀ reproductive number, herd immunity thresholds), transportation (traffic flow, airline routes), protein interactions (cellular machinery), citation networks (scientific influence).",
				"Optimization principles appear universally: evolution (fitness maximization via natural selection, genetic algorithms mimic this), economics (utility/profit maximization under constraints, Pareto efficiency), engineering (minimize cost/weight/energy, maximize performance/efficiency), machine learning (gradient descent minimizes loss functions: cross-entropy, MSE), physics (principle of least action: ∫L dt is extremized, Fermat's principle for light), ecology (optimal foraging theory), neuroscience (efficient coding hypothesis, sparse representations).",
				"Feedback loops fundamental to: control systems (thermostats, PID controllers, autopilots stabilize via negative feedback), climate (ice-albedo positive feedback amplifies warming, water vapor triples CO2 effect), markets (boom-bust cycles: leverage amplifies gains/losses, bank runs self-fulfill), biology (homeostasis: blood glucose, temperature regulation; gene regulatory networks: lac operon), social dynamics (arms races, fashion trends, social proof), immune system (antibody production, inflammation), ecosystems (predator-prey oscillations: Lotka-Volterra equations).",
				"Scaling laws and power laws reveal universal patterns: city dynamics (productivity/innovation/crime scale superlinearly with population: Y ~ N^1.15, West's theory), metabolic rates (Kleiber's law: metabolism ~ mass^0.75, fractal networks optimize transport), earthquake magnitude (Gutenberg-Richter: log N = a - bM), wealth distribution (Pareto: 80/20 rule, richest 1% own 50% wealth), word frequency (Zipf's law: rank × frequency = constant), network connectivity (Barabási-Albert preferential attachment: rich get richer), income inequality (Gini coefficient), species abundance, solar flare intensities.",
				"Phase transitions mark qualitative transformations: physics (water/ice at 0°C: first-order transition, liquid-gas critical point: continuous transition), chemistry (gelation, crystallization), biology (ecosystem collapse, extinction cascades, species invasions), social systems (revolutions, paradigm shifts, norm cascades), markets (crashes: Black Monday '87, Flash Crash 2010), neural dynamics (epileptic seizures, consciousness), percolation theory (connectivity threshold), magnetism (Curie temperature: spontaneous symmetry breaking), quantum (Bose-Einstein condensates).",
				"Conservation principles constrain dynamics: physics (energy, momentum, angular momentum, charge - Noether's theorem links symmetries to conservation laws), economics (budget constraints, zero-sum games), information (Landauer limit: kT ln2 per bit erasure), ecology (mass/energy conservation in food webs, nutrient cycles), cognitive science (attention, working memory capacity ~7±2 items, conservation of processing resources), thermodynamics (1st law: energy conserved, 2nd law: entropy increases).",
				"Hierarchical organization enables complexity: atoms → molecules → cells → organisms → populations → ecosystems (biology), quarks → nucleons → nuclei → atoms → molecules (physics), neurons → circuits → brain regions → cognitive systems (neuroscience), individuals → families → communities → nations (sociology), functions → modules → systems → programs (software), particles → fields → spacetime → universe (cosmology). Each level has emergent properties and autonomous dynamics.",
				"Symmetry and symmetry breaking generate structure: fundamental physics (gauge symmetries define forces, Higgs breaks electroweak), crystallography (230 space groups), biology (bilateral symmetry, homeotic genes), mathematics (group theory, representation theory), art and aesthetics (balance, patterns), cosmology (CMB perturbations from quantum fluctuations), particle physics (matter-antimatter asymmetry explains existence), social systems (equality vs stratification).",
				"Evolutionary dynamics transcend biology: genetic evolution (variation, selection, heredity), cultural evolution (memes, traditions, institutions), technological evolution (innovation diffusion, path dependence), scientific evolution (theory selection, paradigm competition), economic evolution (firms, markets, business models), linguistic evolution (language change, syntax trees), immune system evolution (somatic hypermutation, clonal selection), neural evolution (synaptic plasticity, learning). Universal algorithm: replicate, vary, select.",
				"Criticality and tipping points appear at phase boundaries: brain near critical point (avalanches, optimal information processing), ecosystems (resilience loss before collapse), climate (ice sheet disintegration, Atlantic circulation shutdown), markets (bubbles burst suddenly), social movements (revolution thresholds), sandpile model (self-organized criticality), forest fires, earthquakes. Systems exhibit: (1) early warning signals (critical slowing down, rising variance), (2) hysteresis (hard to reverse), (3) regime shifts (alternative stable states).",
			],

			// Meta-cognitive strategies for expert-level reasoning
			thinkingStrategies: [
				"First principles thinking: Break down to fundamental truths, rebuild from ground up. Question assumptions ruthlessly. Example: Elon Musk on rocket costs - ignore market price, calculate raw material costs, realize 98% markup. Strip away analogies, conventions, received wisdom. Ask: What must be true? What is physically possible? Socrates' method: keep asking 'why' until bedrock.",
				"Second-order thinking: Consider consequences of consequences. Think several moves ahead like chess grandmaster. Anticipate ripple effects, feedback loops, unintended consequences. Example: Antibiotics → resistant bacteria, rent control → housing shortage, invasive species → ecosystem collapse. Ask: And then what? What does everyone else do? What are the long-run equilibria?",
				"Inversion: Instead of asking 'how to succeed', ask 'how to fail' and avoid those. Via negativa - improve by subtraction. Charlie Munger: 'Invert, always invert.' Negative space reveals structure - sculptor removes stone to find statue. Pre-mortem: assume failure, explain why. Stoic negative visualization builds resilience. Focus on avoiding stupidity over seeking brilliance.",
				"Analogical transfer: Map solutions from one domain to another. Biology → engineering (biomimicry: velcro from burrs, sonar from bats, self-healing from skin). Physics → economics (thermodynamics/equilibrium, Newtonian laws/game theory). Computer science → biology (DNA as code, immune system as distributed computing). Mathematics everywhere (fractals in coastlines/lungs/trees). Recognize isomorphic structures.",
				"Reframing: Change perspective to reveal new solutions. Problem → opportunity (crisis in Chinese = danger + opportunity). Threat → challenge (stress response → eustress, growth mindset). Constraint → creative catalyst (haiku's structure, Twitter's 280 chars, poverty → frugal innovation). Gestalt switches flip meaning (old woman/young woman, duck/rabbit). Multiple frames = cognitive flexibility.",
				"Scenario planning: Explore multiple futures. Best case, worst case, most likely - plan for all. Monte Carlo simulations sample possibility space. Shell's scenarios anticipated oil shocks. Climate models run ensembles. Robust strategies work across scenarios. Avoid planning fallacy (underestimate time/costs), black swan blindness (ignore tail risks). Prepare for uncertainty, don't predict.",
				"Red teaming: Challenge your own ideas. Steel man opposing views (strongest version of argument). Find weaknesses before others do. Devil's advocate role. Adversarial collaboration (Kahneman/Klein on intuition). Institutional: CIA's Team B, Pentagon war games. Intellectual: peer review, replication. Personal: kill your darlings, falsify not verify. Seek disconfirmation actively.",
				"Abstraction ladders: Move between concrete/abstract. Concrete: specific examples, sensory details, anecdotes. Abstract: principles, patterns, generalizations. Expert thinking climbs ladder: see deep structure beneath surface features (chess: not pieces, but pawn structures). Teaching requires descent: translate abstract to concrete (metaphors, analogies, stories). Semantic gradients map concept space.",
				"Probabilistic thinking: Replace binary true/false with confidence levels. Bayesian updating: prior × evidence = posterior. Fermi estimation for order-of-magnitude (Drake equation, back-of-envelope). Expected value = probability × payoff (Kelly criterion for bet sizing). Confidence intervals quantify uncertainty. Calibration: align stated confidence with accuracy. Base rates prevent fallacies.",
				"Lateral thinking: Break patterns via provocation, random entry, challenge. Edward de Bono's methods: PO (provocative operation), random word association, reversal (do opposite), exaggeration (amplify to absurdity). Creativity techniques: SCAMPER (substitute, combine, adapt, modify, purpose, eliminate, reverse), morphological analysis, synectics. Incubation lets unconscious process. Constraints force novelty.",
				"Systems thinking: See wholes not parts, relationships not objects. Identify feedback loops (R amplifies, B stabilizes), delays (lag between action/consequence), leverage points (Meadows' hierarchy: constants < buffers < structures < delays < feedback < rules < goals < paradigms). Iceberg model: events → patterns → structures → mental models. Causal loop diagrams, stock-flow models. Avoid linear thinking in non-linear world.",
				"Occam's razor: Simplest explanation is usually correct (among explanations of equal predictive power). Parsimony principle. Avoid multiplying entities unnecessarily. Solomonoff's universal prior weights hypotheses by complexity. Minimum description length. But beware: Einstein 'as simple as possible, but no simpler.' Reality is complex - don't oversimplify.",
				"Empiricism and experimentation: Test don't guess. A/B testing, randomized controlled trials, natural experiments. Falsifiability (Popper): science must make risky predictions. Replication crisis highlights publication bias, p-hacking, HARKing. Pre-registration prevents post-hoc theorizing. Open science, data sharing. Skepticism as virtue - extraordinary claims require extraordinary evidence (Sagan standard).",
				"Interdisciplinary synthesis: Combine insights across fields. E.O. Wilson's consilience. Jared Diamond's guns/germs/steel integrates history/biology/geography. Cognitive science fuses psychology/neuroscience/AI/philosophy/linguistics. Renaissance polymaths (Da Vinci). Modern: Feynman in physics/biology, Hofstadter in AI/music/art, Kahneman in psych/econ. T-shaped expertise: depth + breadth.",
				"Historical reasoning: Learn from past. Santayana: 'Those who cannot remember the past are condemned to repeat it.' Pattern recognition across time (rise/fall of empires, financial manias, technological revolutions). Avoid presentism (judging past by current standards). Understand context, contingency. Thucydides' History as timeless insights on power, human nature. Lindy effect: longevity predicts future survival.",
			],

			// Domain-specific encyclopedic knowledge - 250% expansion
			domainEncyclopedia: {
				physics: {
					foundations:
						"Standard Model unifies electromagnetic, weak, strong forces via gauge symmetries (U(1)×SU(2)×SU(3)). 17 particles: 6 quarks (up/down/charm/strange/top/bottom), 6 leptons (e/μ/τ + neutrinos), 4 bosons (photon/W/Z/gluon), Higgs. QCD explains strong force via color charge, asymptotic freedom (high energy → weak coupling). Electroweak unification (Glashow-Weinberg-Salam). Missing: quantum gravity (Planck scale 10^19 GeV), dark matter (27% of universe), dark energy (68%, Λ cosmological constant). String theory proposes 10-11D vibrating strings. Loop quantum gravity quantizes spacetime itself.",
					relativity:
						"Special relativity (1905): spacetime interval invariant, time dilation (Δt' = γΔt), length contraction (L' = L/γ), E=mc², mass-energy equivalence, simultaneity relative. General relativity (1915): gravity as spacetime curvature (Einstein field equations: Gμν = 8πGTμν), geodesics, black holes (Schwarzschild/Kerr/Reissner-Nordström), gravitational waves detected (LIGO 2015), cosmology (expanding universe, Big Bang, CMB). Tests: precession of Mercury, gravitational lensing, GPS corrections, time dilation confirmed.",
					quantum:
						"Wave-particle duality, uncertainty principle (ΔxΔp ≥ ℏ/2), Schrödinger equation describes evolution, measurement collapses superposition, entanglement (Einstein's 'spooky action'), Bell's theorem rules out local hidden variables, quantum computing exploits superposition/entanglement for exponential speedup (Shor's algorithm factors in polynomial time). Interpretations: Copenhagen (collapse), Many-Worlds (branching), Bohmian (pilot wave). Decoherence explains classical emergence.",
					thermodynamics:
						"0th law: thermal equilibrium transitive. 1st law: energy conserved (dU = δQ - δW). 2nd law: entropy increases in isolated systems (ΔS ≥ 0), defines time's arrow, limits efficiency (Carnot: η = 1 - Tc/Th). 3rd law: entropy → 0 as T → 0. Statistical mechanics: S = k ln Ω connects macro (entropy) to micro (microstates). Maxwell's demon resolved by Landauer's principle. Applications: engines, refrigerators, chemistry, information theory, cosmology.",
					cosmology:
						"Universe 13.8 billion years old, began in Big Bang (Hubble expansion, CMB at 2.7K, nucleosynthesis). Inflation explains flatness, horizon problems. Structure from quantum fluctuations amplified by gravity. Dark matter holds galaxies (rotation curves, gravitational lensing). Dark energy accelerates expansion (Type Ia supernovae). Fate depends on density: open (expand forever), closed (Big Crunch), flat (critical density). Multiverse theories: eternal inflation, Many-Worlds, string landscape.",
				},
				mathematics: {
					analysis:
						"Calculus: limits define continuity, derivatives measure rates, integrals compute areas/totals. Fundamental theorem links them (∫f' = f(b) - f(a)). Real analysis: completeness of ℝ, convergence, Cauchy sequences, compactness, Bolzano-Weierstrass. Complex analysis: holomorphic functions, Cauchy integral formula, residue theorem, conformal maps. Fourier analysis: decompose into frequencies, applications in signal processing, quantum mechanics, PDEs. Functional analysis: infinite-dimensional spaces, Hilbert spaces, operators, spectral theory.",
					algebra:
						"Groups: symmetries, composition (associative, identity, inverses). Rings: addition + multiplication (integers, polynomials). Fields: division allowed (rationals, reals, complex, finite fields Fp). Galois theory connects field extensions to groups, proves quintic unsolvable by radicals. Linear algebra: vector spaces, matrices, determinants, eigenvalues/eigenvectors, SVD, spectral theorem. Applications: computer graphics, machine learning, quantum mechanics, cryptography.",
					geometry:
						"Euclidean: parallel postulate, Pythagorean theorem, area/volume formulas. Non-Euclidean: hyperbolic (negative curvature, parallel lines diverge), elliptic (positive curvature, no parallels). Differential geometry: manifolds, tangent spaces, curvature, geodesics, Riemannian metrics. Topology: properties preserved under continuous deformation (genus, Euler characteristic), homology, fundamental group. Algebraic geometry: solutions to polynomial equations, varieties, schemes, powerful but abstract.",
					logic: "Propositional logic: AND/OR/NOT/IMPLIES, truth tables, tautologies. Predicate logic: ∀∃ quantifiers, formulas, models. Completeness (Gödel): syntactic proofs match semantic truth. Incompleteness theorems: consistent systems can't prove all truths (1st), can't prove own consistency (2nd). Computability: Turing machines, Church-Turing thesis, undecidable problems (Halting). Complexity theory: P vs NP, reductions, NP-completeness (SAT, traveling salesman, graph coloring).",
					numberTheory:
						"Primes: infinite (Euclid), distribution (Prime Number Theorem: π(n) ~ n/ln n), gaps, twin primes conjecture. Modular arithmetic: clock arithmetic, Chinese Remainder Theorem. Fermat's Last Theorem proved by Wiles (1995) via elliptic curves/modular forms. Riemann Hypothesis: ζ(s) zeros lie on Re(s)=1/2 line, deepest mystery. Applications: RSA encryption (factoring hard), elliptic curve cryptography, hashing, error correction.",
				},
				computerScience: {
					algorithms:
						"Sorting: O(n log n) optimal comparison-based (merge sort, quick sort, heap sort). Searching: binary search O(log n) on sorted. Graph algorithms: BFS/DFS O(V+E), Dijkstra O((V+E) log V) shortest paths, Bellman-Ford handles negatives, Floyd-Warshall all-pairs. Dynamic programming: memoization, optimal substructure (knapsack, edit distance, LCS). Greedy: local optimal → global (Huffman codes, MST). Divide-and-conquer: split, recurse, combine (FFT, Strassen).",
					dataStructures:
						"Arrays: O(1) access, O(n) insert/delete. Linked lists: O(1) insert, O(n) search. Hash tables: O(1) average for insert/search/delete via hashing + chaining/open addressing. Trees: binary search trees (O(log n) balanced), AVL, red-black. Heaps: O(log n) insert/extract-min, priority queues. Graphs: adjacency lists/matrices. Advanced: B-trees (databases), tries (strings), disjoint sets (union-find), skip lists, Bloom filters (probabilistic).",
					machineLearning:
						"Supervised: learn f: X→Y from labeled data. Linear/logistic regression, SVM, decision trees/random forests, neural networks (feedforward, CNN for images, RNN/LSTM/Transformer for sequences). Gradient descent optimizes loss via ∇L. Backpropagation computes gradients efficiently. Unsupervised: clustering (k-means, hierarchical, DBSCAN), dimensionality reduction (PCA, t-SNE, autoencoders). Reinforcement learning: agent learns policy via rewards (Q-learning, policy gradients, AlphaGo). Deep learning scales with data/compute, attention mechanisms dominate NLP (BERT, GPT, Transformers).",
					systems:
						"Operating systems: process scheduling (round-robin, priority), memory management (paging, segmentation, virtual memory), file systems (inodes, FAT, NTFS, ext4), concurrency (locks, semaphores, monitors, deadlock). Databases: ACID (atomicity, consistency, isolation, durability), transactions, B+ trees for indexing, query optimization, NoSQL (key-value, document, graph). Networks: OSI layers, TCP/IP, routing (BGP, OSPF), DNS, HTTP/HTTPS, CDNs. Distributed systems: CAP theorem (consistency, availability, partition tolerance - pick 2), consensus (Paxos, Raft), MapReduce, microservices.",
					security:
						"Cryptography: symmetric (AES), asymmetric (RSA, elliptic curve), hashing (SHA-256, bcrypt), digital signatures, key exchange (Diffie-Hellman). Attacks: buffer overflow, SQL injection, XSS, CSRF, man-in-the-middle. Defenses: encryption, authentication, access control, input validation, sandboxing. Blockchain: distributed ledger, proof-of-work, smart contracts. Zero-knowledge proofs prove statement without revealing details. Post-quantum cryptography resists quantum attacks.",
				},
				biology: {
					evolution:
						"Natural selection (Darwin): variation, inheritance, differential reproduction. Modern synthesis integrates genetics (Mendelian inheritance, DNA). Mechanisms: mutation (random), recombination (sex), drift (chance), selection (adaptation). Evidence: fossil record (transitional forms), comparative anatomy (homology), embryology (conserved development), molecular (DNA/protein sequences, phylogenetic trees), biogeography (islands), experiments (finch beaks, bacteria). Speciation via reproductive isolation. Punctuated equilibrium vs gradualism. Evo-devo: regulatory genes (Hox) control body plans.",
					genetics:
						"DNA double helix (Watson-Crick), base pairing (A-T, C-G). Central dogma: DNA → RNA → protein. Transcription (RNA polymerase), translation (ribosomes, tRNA). Genetic code: 64 codons, 20 amino acids, nearly universal. Mutations: point (SNPs), insertion/deletion (indels), chromosomal (duplication, inversion). Regulation: promoters, enhancers, transcription factors, epigenetics (methylation, histones). Mendelian genetics: dominant/recessive, segregation, independent assortment. Linkage, crossing over, genetic mapping. Modern: CRISPR gene editing, sequencing (Sanger, next-gen), genomics, personalized medicine.",
					ecology:
						"Populations: growth (exponential r, logistic K carrying capacity), demographics, life tables. Communities: competition (exclusion principle), predation (Lotka-Volterra), symbiosis (mutualism, commensalism, parasitism), niches. Ecosystems: energy flow (trophic levels, 10% rule), nutrient cycles (carbon, nitrogen, phosphorus), food webs, keystone species. Succession: primary (new habitat), secondary (disturbance), climax community. Biodiversity: species richness/evenness, hotspots, threats (habitat loss, invasive species, climate change, overexploitation). Conservation biology: protected areas, corridors, ex-situ breeding.",
					neuroscience:
						"Neurons: dendrites (input), soma (integration), axon (output), synapses (chemical/electrical). Action potential: Na+ influx depolarizes, K+ efflux repolarizes, propagates down axon. Neurotransmitters: glutamate (excitatory), GABA (inhibitory), dopamine (reward), serotonin (mood), acetylcholine (motor). Brain regions: cortex (higher functions), hippocampus (memory), amygdala (emotion), basal ganglia (movement), cerebellum (coordination). Plasticity: LTP/LTD (synaptic strength changes), neurogenesis. Methods: fMRI, EEG, optogenetics, recordings. Consciousness, free will remain mysteries.",
					molecularBiology:
						"Proteins: amino acid chains fold into 3D structures (primary/secondary/tertiary/quaternary), enzymes catalyze reactions (lock-and-key, induced fit, activation energy lowering). Biochemistry: metabolism (catabolism breaks down, anabolism builds up), glycolysis, Krebs cycle, electron transport chain (ATP synthase), photosynthesis (light/dark reactions, Calvin cycle). Cell biology: organelles (nucleus, mitochondria, ER, Golgi, lysosomes), membrane transport (diffusion, active transport, channels), cell cycle (G1-S-G2-M, checkpoints), apoptosis. Techniques: PCR, gel electrophoresis, Western blot, mass spec, X-ray crystallography, cryo-EM.",
				},
				chemistry: {
					atomicStructure:
						"Quantum model: electrons in orbitals (s, p, d, f), Pauli exclusion, Aufbau principle, Hund's rule. Periodic table: groups (vertical, similar chemistry), periods (horizontal, shells), trends (electronegativity, ionization energy, atomic radius). Bonding: ionic (electron transfer, lattice energy), covalent (electron sharing, sigma/pi bonds, hybridization sp³/sp²/sp), metallic (electron sea), hydrogen bonds, van der Waals. Molecular geometry: VSEPR theory, Lewis structures, resonance, formal charge.",
					reactions:
						"Types: synthesis, decomposition, single/double replacement, combustion, acid-base (Brønsted-Lowry: H+ donor/acceptor), redox (oxidation states, electron transfer). Kinetics: rate laws (rate = k[A]^m[B]^n), Arrhenius equation (k = Ae^(-Ea/RT)), activation energy, catalysts lower Ea. Equilibrium: Le Chatelier's principle (stress shifts balance), Kc, Kp, solubility product Ksp, pH = -log[H+]. Thermodynamics: ΔG = ΔH - TΔS determines spontaneity, ΔG° = -RT ln K.",
					organic:
						"Functional groups: alcohols (-OH), aldehydes/ketones (C=O), carboxylic acids (-COOH), amines (-NH2), ethers, esters. Nomenclature: IUPAC rules. Reactions: substitution, elimination, addition, oxidation/reduction. Mechanisms: SN1/SN2, E1/E2, electrophilic aromatic substitution. Stereochemistry: chirality, enantiomers (mirror images), diastereomers, R/S configuration, optical activity. Polymers: addition (polyethylene), condensation (nylon), biological (proteins, DNA). Spectroscopy: IR (bonds), NMR (structure), mass spec (molecular weight).",
					inorganic:
						"Coordination complexes: metal centers, ligands (mono/multidentate, chelation), crystal field theory (d-orbital splitting, high/low spin, color). Transition metals: variable oxidation states, colored ions, catalysts. Main group: boron clusters, silicon materials, sulfur/phosphorus chemistry. Solid state: crystal structures (FCC, BCC, HCP), band theory (conductors, semiconductors, insulators), doping. Acids/bases: Lewis (electron pair), Brønsted (proton), strength trends. Organometallics: Grignard reagents, ferrocene, catalysis (Haber, Ziegler-Natta, cross-coupling).",
				},
				philosophy: {
					metaphysics:
						"What exists? Materialism (only matter), idealism (only mind), dualism (both). Substance (what things are made of), properties (attributes), relations. Universals vs particulars: realism (universals exist independently), nominalism (only names), conceptualism (mental constructs). Causation: Humean regularity, counterfactual dependence, powers/dispositions. Identity: persistence through time (endurantism, perdurantism), composition (when do parts make whole?). Modality: necessity, possibility, possible worlds (Lewis).",
					epistemology:
						"What is knowledge? JTB (justified true belief) challenged by Gettier. Foundationalism: basic beliefs support others. Coherentism: mutual support like web. Reliabilism: true belief via reliable process. Internalism vs externalism: must justification be accessible? Skepticism: can we know anything? (Descartes' demon, brain in vat). A priori (independent of experience: math, logic) vs a posteriori (empirical). Analytic (true by meaning) vs synthetic (substantive). Rationalism (Descartes: innate ideas) vs empiricism (Locke: tabula rasa).",
					ethics: "Normative theories: Utilitarianism (maximize utility, consequentialism, Mill/Bentham), Deontology (duty/rules, categorical imperative, Kant), Virtue ethics (character, Aristotle's eudaimonia). Applied: bioethics (abortion, euthanasia, enhancement), environmental (anthropocentrism vs biocentrism), business, AI alignment. Meta-ethics: moral realism (facts exist objectively) vs anti-realism (subjectivism, emotivism, error theory). Moral psychology: trolley problem, dual-process theory (intuition vs reasoning, Haidt), moral foundations (harm, fairness, loyalty, authority, sanctity).",
					logicAndLanguage:
						"Formal logic: propositional, predicate, modal (necessity, possibility). Philosophy of language: meaning (reference, sense), truth conditions, speech acts (Austin), pragmatics (Grice's maxims), meaning as use (Wittgenstein). Logical positivism: verification principle, later rejected. Ordinary language philosophy: philosophical problems from linguistic confusion. Analytic tradition: clarity, argument, science-aligned (Russell, Quine, Kripke). Continental: phenomenology (Husserl), existentialism (Sartre), hermeneutics (Heidegger), post-structuralism (Derrida, Foucault).",
					mindAndConsciousness:
						"Mind-body problem: dualism (Descartes: res cogitans + res extensa), physicalism (identity theory, functionalism, eliminativism), property dualism (emergent properties). Hard problem of consciousness (Chalmers): why subjective experience? Qualia (redness of red). Zombies (behaviorally identical, no consciousness) conceivable? Theories: Global Workspace, IIT (Integrated Information), Higher-Order Thought. Free will: libertarianism (real choice), compatibilism (compatible with determinism), hard determinism (illusion). Personal identity: psychological continuity (Locke), bodily (animalism), no-self (Buddhism, Parfit).",
				},
				economics: {
					microeconomics:
						"Supply and demand: equilibrium price clears market. Elasticity measures responsiveness (elastic >1, inelastic <1). Consumer theory: utility maximization subject to budget constraint, indifference curves, substitution/income effects. Producer theory: profit maximization, marginal cost = marginal revenue, economies of scale. Market structures: perfect competition (price takers), monopoly (price makers, deadweight loss), oligopoly (game theory, cartels), monopolistic competition. Externalities: Pigovian taxes internalize costs. Public goods: non-rival, non-excludable, free-rider problem. Information asymmetry: adverse selection, moral hazard, signaling (Spence).",
					macroeconomics:
						"GDP = C + I + G + (X-M). Business cycles: expansion, peak, recession, trough. Unemployment: frictional, structural, cyclical, NAIRU. Inflation: demand-pull, cost-push, measured by CPI. Phillips curve: inflation-unemployment trade-off (short-run), vertical long-run. IS-LM model: goods/money market equilibrium. AD-AS model: aggregate demand/supply, shocks. Monetary policy: central bank sets interest rates (fed funds rate), QE expands balance sheet. Fiscal policy: government spending/taxes, multiplier effect, crowding out. Growth: Solow model (capital accumulation, diminishing returns, TFP), endogenous growth (R&D, human capital, Romer).",
					finance:
						"Time value: PV = FV/(1+r)^t. Stocks: ownership, dividends, capital gains. Bonds: debt, coupon payments, yield curve. Diversification reduces risk (portfolio theory, Markowitz). CAPM: E(Ri) = Rf + βi(E(Rm) - Rf), beta measures systematic risk. EMH: prices reflect all available information (weak, semi-strong, strong forms), challenged by anomalies, behavioral finance. Options: call (buy right), put (sell right), Black-Scholes model. Derivatives: futures, swaps, hedge risk. Crises: 2008 subprime mortgage collapse, leverage amplified losses, too big to fail.",
					behavioral:
						"Heuristics: availability (judging probability by ease of recall), representativeness (stereotypes), anchoring (initial value biases). Biases: confirmation (seek confirming evidence), overconfidence (overestimate knowledge), loss aversion (losses hurt 2x gains), status quo, framing effects, sunk cost fallacy, present bias (hyperbolic discounting). Prospect theory (Kahneman-Tversky): value function (concave gains, convex losses, kinked at origin), probability weighting (overweight rare events). Nudges: choice architecture steers decisions (defaults, salience). Applications: saving (auto-enrollment in 401k), health (organ donation), policy.",
				},
				history: {
					ancientCivilizations:
						"Mesopotamia (3500 BCE): Sumerians invent writing (cuneiform), wheel, irrigation. Code of Hammurabi (1754 BCE). Egypt: pyramids, pharaohs, hieroglyphics, Nile floods enable agriculture. Indus Valley: urban planning (Harappa, Mohenjo-Daro), sanitation. China: Shang dynasty (1600 BCE), oracle bones, mandate of heaven, Confucius/Laozi. Greece: democracy (Athens), philosophy (Socrates/Plato/Aristotle), science (Euclid, Archimedes), Alexander's empire. Rome: republic → empire (27 BCE), law (Twelve Tables, Justinian Code), roads, aqueducts, Pax Romana, fall (476 CE).",
					medievalToModern:
						"Middle Ages (500-1500): feudalism, Catholic Church dominance, Crusades, Black Death (1347-1353) kills 30-60% of Europe. Islamic Golden Age: algebra (al-Khwarizmi), medicine (Avicenna), astronomy. Renaissance (1400-1600): humanism, art (Leonardo, Michelangelo), printing press (Gutenberg 1440). Reformation: Luther's 95 Theses (1517), Protestant split. Scientific Revolution: heliocentrism (Copernicus, Galileo), physics (Newton), method (Bacon, Descartes). Enlightenment (1700s): reason, liberty, progress (Locke, Voltaire, Kant).",
					revolutions:
						"Industrial Revolution (1760-1840): steam engine, factories, urbanization, railroads, massive productivity gains but harsh working conditions, Marx critiques capitalism. American Revolution (1776): independence from Britain, Constitution, democracy experiment. French Revolution (1789): overthrow monarchy, Declaration of Rights, Reign of Terror, Napoleon. Haitian Revolution (1791-1804): first successful slave revolt. Revolutions of 1848: liberal/nationalist uprisings across Europe, mostly failed but spread ideas. Russian Revolutions: 1905 (constitutional), 1917 (Bolshevik, Lenin, communism). Chinese Revolution (1949): Mao's communists defeat nationalists.",
					worldWars:
						"WWI (1914-1918): trench warfare, machine guns, poison gas, tanks, aviation. Causes: alliances, imperialism, nationalism, assassination of Franz Ferdinand. Treaty of Versailles punishes Germany, sets stage for WWII. WWII (1939-1945): Axis (Germany, Japan, Italy) vs Allies (US, UK, USSR, China). Holocaust kills 6M Jews, 5M others. Nuclear bombs (Hiroshima, Nagasaki) end Pacific war. UN founded (1945). Cold War (1947-1991): US vs USSR, nuclear arms race (MAD), proxy wars (Korea, Vietnam, Afghanistan), space race, ideological conflict (capitalism vs communism), falls with Berlin Wall (1989), USSR dissolves (1991).",
					modern: "Decolonization (1945-1975): India (1947), Africa (1960s), end of European empires. Civil Rights Movement (US 1950s-60s): desegregation, voting rights, MLK Jr. Feminist movements: suffrage (1920s), second wave (1960s-80s, equal rights), third wave (1990s, intersectionality). Digital Revolution (1980s-present): personal computers, internet (1990s), smartphones (2007), social media (2004+), AI (2010s+). Globalization: trade liberalization, multinationals, cultural exchange, inequality debates. Climate change: scientific consensus (IPCC), Paris Agreement (2015), renewable energy transition. COVID-19 pandemic (2020-2023): lockdowns, vaccines (mRNA), remote work.",
				},
			},

			// Scientific methods and research practices
			scientificMethod: {
				steps: "1. Observation: identify phenomenon, gather data. 2. Question: formulate research question. 3. Hypothesis: testable prediction, explains mechanism. 4. Experiment: controlled test, manipulate independent variable, measure dependent, control confounds. 5. Analysis: statistical tests, significance (p<0.05), effect sizes, confidence intervals. 6. Conclusion: accept/reject hypothesis, limitations, future work. 7. Replication: verify results, publish for peer review.",
				designPrinciples:
					"Randomization: removes selection bias. Control groups: isolate treatment effect. Blinding: prevents placebo effects, observer bias (single-blind: participants, double-blind: participants + experimenters). Sample size: adequate power (typically 80%) to detect effects, avoid false negatives. Pre-registration: prevents HARKing (hypothesizing after results known), p-hacking. Reproducibility: share data, code, methods. Meta-analysis: synthesize multiple studies, more reliable than single study.",
				statistics:
					"Descriptive: mean, median, mode, standard deviation, variance, quartiles, visualizations (histograms, box plots, scatter plots). Inferential: hypothesis testing (null vs alternative, Type I/II errors, α/β, power), t-tests, ANOVA, chi-square, regression (linear, logistic, multiple), correlation (≠ causation). Bayesian: prior + data = posterior, credible intervals, Bayes factors. Causal inference: RCTs gold standard, observational (propensity scores, instrumental variables, regression discontinuity, difference-in-differences).",
			},

			// Critical thinking and fallacies
			logicalFallacies: {
				formal: "Affirming the consequent: If P then Q, Q, therefore P (invalid). Denying the antecedent: If P then Q, not P, therefore not Q (invalid). Non sequitur: conclusion doesn't follow from premises.",
				informal:
					"Ad hominem: attack person not argument. Straw man: misrepresent argument to refute weaker version. Appeal to authority: expert opinion not evidence (unless in their domain). Appeal to emotion: manipulate feelings not reasoning. False dichotomy: only two options when more exist. Slippery slope: chain reaction assumed without justification. Hasty generalization: small sample to broad conclusion. Post hoc ergo propter hoc: correlation implies causation. Begging the question: circular reasoning, assume conclusion. Red herring: irrelevant distraction. Tu quoque: 'you too' deflection. No true Scotsman: ad hoc definition change. Bandwagon: popular doesn't mean correct. Naturalistic fallacy: natural equals good. Gambler's fallacy: past events affect independent future events.",
				cognitive:
					"Confirmation bias: seek confirming evidence, ignore disconfirming. Availability heuristic: overestimate probability of vivid/recent events. Anchoring: first number biases estimates. Dunning-Kruger: incompetent overestimate ability, experts underestimate. Hindsight bias: 'I knew it all along' after learning outcome. Base rate neglect: ignore prior probabilities. Conjunction fallacy: P(A&B) > P(A) seems plausible. Sunk cost: past costs influence future decisions irrationally. Status quo bias: prefer current state. Loss aversion: losses hurt more than equivalent gains feel good. Framing: presentation affects choice. Overconfidence: miscalibration of confidence vs accuracy.",
			},
		},
	};

	// Advanced intent analysis with multi-dimensional understanding
	analyzeIntent(input: string): {
		type: "question" | "statement" | "greeting" | "gratitude" | "farewell" | "hypothetical" | "comparison";
		questionType?: string;
		topics: string[];
		complexity: "simple" | "medium" | "complex" | "expert";
		sentiment: "positive" | "neutral" | "negative" | "curious";
		requiresReasoning: boolean;
		requiresMultiStep: boolean;
	} {
		const lower = input.toLowerCase();
		const words = input.split(/\s+/);
		const wordCount = words.length;

		// Social interaction detection
		if (this.knowledgeBase.greetings.some((g) => lower.includes(g))) {
			return {
				type: "greeting",
				topics: ["social"],
				complexity: "simple",
				sentiment: "positive",
				requiresReasoning: false,
				requiresMultiStep: false,
			};
		}
		if (this.knowledgeBase.gratitude.some((t) => lower.includes(t))) {
			return {
				type: "gratitude",
				topics: ["social"],
				complexity: "simple",
				sentiment: "positive",
				requiresReasoning: false,
				requiresMultiStep: false,
			};
		}
		if (this.knowledgeBase.farewells.some((f) => lower.includes(f))) {
			return {
				type: "farewell",
				topics: ["social"],
				complexity: "simple",
				sentiment: "neutral",
				requiresReasoning: false,
				requiresMultiStep: false,
			};
		}

		// Detect question type and classification
		let questionType: string | undefined;
		let isQuestion = lower.includes("?");

		for (const [qType, patterns] of Object.entries(this.knowledgeBase.questions)) {
			if (patterns.some((p) => lower.includes(p))) {
				isQuestion = true;
				questionType = qType;
				break;
			}
		}

		// Hypothetical and comparison detection
		const isHypothetical = /if|suppose|imagine|what if|hypothetically|would you|could you|scenario/.test(lower);
		const isComparison = /compare|versus|vs\b|better|worse|difference between|rather than|instead of/.test(lower);

		// Multi-topic detection (can span multiple domains)
		const detectedTopics: string[] = [];
		for (const [topic, keywords] of Object.entries(this.knowledgeBase.topics)) {
			if (keywords.some((kw) => lower.includes(kw))) {
				detectedTopics.push(topic);
			}
		}
		if (detectedTopics.length === 0) detectedTopics.push("general");

		// Advanced complexity analysis with sophisticated heuristics
		const hasComplexTerms =
			/therefore|consequently|furthermore|moreover|nevertheless|hypothesis|paradigm|implications|synthesis|emergent|epistemolog|ontolog|heuristic|algorithm|optimization|equilibrium|asymptotic|differential|integral|quantum|relativity|consciousness|metaphysics|phenomenolog/.test(
				lower
			);
		const hasAbstractConcepts = /concept|theory|framework|principle|mechanism|system|structure|relationship|causality/.test(
			lower
		);
		const hasPhilosophicalDepth = /meaning|purpose|truth|reality|existence|consciousness|ethics|morality|justice/.test(lower);
		const hasScientificRigor = /experiment|evidence|data|research|study|empirical|hypothesis|correlation|causation/.test(
			lower
		);
		const hasMultipleClauses = (input.match(/[,;]/g) || []).length > 2;
		const hasTechnicalDepth = detectedTopics.length > 1 || hasComplexTerms || hasAbstractConcepts;
		const hasInterdisciplinary = detectedTopics.length >= 2;

		// Sophisticated complexity scoring (0-100)
		let complexityScore = 0;
		complexityScore += wordCount * 0.5; // Length factor
		complexityScore += hasComplexTerms ? 20 : 0;
		complexityScore += hasAbstractConcepts ? 15 : 0;
		complexityScore += hasPhilosophicalDepth ? 18 : 0;
		complexityScore += hasScientificRigor ? 16 : 0;
		complexityScore += hasMultipleClauses ? 12 : 0;
		complexityScore += detectedTopics.length * 8; // Multi-domain bonus
		complexityScore += hasInterdisciplinary ? 15 : 0;
		complexityScore += questionType === "why" ? 10 : 0;
		complexityScore += isHypothetical ? 12 : 0;

		let complexity: "simple" | "medium" | "complex" | "expert";
		if (complexityScore < 25) complexity = "simple";
		else if (complexityScore < 50) complexity = "medium";
		else if (complexityScore < 75) complexity = "complex";
		else complexity = "expert";

		// Enhanced reasoning requirements
		const requiresReasoning =
			questionType === "why" ||
			isHypothetical ||
			isComparison ||
			hasComplexTerms ||
			hasAbstractConcepts ||
			hasPhilosophicalDepth ||
			/explain|analyze|evaluate|justify|argue|prove|demonstrate|derive|infer|deduce|induce|synthesize/.test(lower);

		const requiresMultiStep =
			hasMultipleClauses || detectedTopics.length > 1 || /steps|process|how to|guide|tutorial/.test(lower);

		// Sentiment analysis
		let sentiment: "positive" | "neutral" | "negative" | "curious";
		if (/love|great|amazing|excellent|wonderful|fantastic|best/.test(lower)) sentiment = "positive";
		else if (/problem|issue|wrong|bad|terrible|worst|fail/.test(lower)) sentiment = "negative";
		else if (/curious|wonder|interested|fascinated|intrigued/.test(lower)) sentiment = "curious";
		else sentiment = "neutral";

		const type = isHypothetical ? "hypothetical" : isComparison ? "comparison" : isQuestion ? "question" : "statement";

		return {
			type,
			questionType,
			topics: detectedTopics,
			complexity,
			sentiment,
			requiresReasoning,
			requiresMultiStep,
		};
	}

	// Chain-of-Thought Reasoning Engine - Model-Aware Intelligence
	private chainOfThoughtReasoning(
		question: string,
		intent: ReturnType<KafelotAI["analyzeIntent"]>
	): { reasoning: string[]; conclusion: string; confidence: number } {
		const reasoningSteps: string[] = [];
		let confidence = 0.6 + this.config.knowledgeDepth * 0.2; // Base confidence scaled by model

		// Model identification
		reasoningSteps.push(`⚡ Model: ${this.config.name} (${this.config.parameters} parameters)`);

		// Step 1: Problem decomposition (depth varies by model)
		if (this.model !== "flash") {
			reasoningSteps.push(`🧠 Analyzing: "${question.slice(0, 100)}${question.length > 100 ? "..." : ""}"`);
		}
		reasoningSteps.push(
			`📊 Complexity: ${intent.complexity} | Topics: ${intent.topics.join(", ")} | Domains: ${intent.topics.length}`
		);

		// Step 2: Knowledge retrieval (model-specific depth)
		const relevantKnowledge = this.retrieveRelevantKnowledge(intent.topics);
		if (relevantKnowledge.length > 0) {
			reasoningSteps.push(`📚 Knowledge: ${relevantKnowledge.join(", ")}`);
			confidence += 0.05 * this.config.knowledgeDepth;
		}

		// Step 3: Logical framework selection
		const logicalFramework = this.selectLogicalFramework(intent);
		if (this.model === "ultra") {
			reasoningSteps.push(`🎯 Framework: ${logicalFramework}`);
		}
		confidence += 0.03;

		// Step 4: Multi-perspective analysis (Pro and Ultra only)
		if (this.model !== "flash" && (intent.complexity === "complex" || intent.complexity === "expert")) {
			reasoningSteps.push(`🔄 Multi-perspective analysis enabled`);
			if (this.model === "ultra") {
				reasoningSteps.push(`      ⟶ Theoretical foundations`);
				reasoningSteps.push(`      ⟶ Practical applications`);
				reasoningSteps.push(`      ⟶ Edge cases & limitations`);
			}
			if (intent.topics.length > 1) {
				const connectedDomains = this.getConnectedDomains(intent.topics);
				if (connectedDomains.length > 0) {
					reasoningSteps.push(`      ⟶ Interdisciplinary synthesis: ${connectedDomains.join(" ↔ ")}`);
					confidence += 0.08;
				}
			}
		}

		// Step 5: Synthesize conclusion
		const conclusion = this.synthesizeConclusion(intent, relevantKnowledge);
		reasoningSteps.push(`✅ Synthesis complete: Ready to provide comprehensive answer`);

		return { reasoning: reasoningSteps, conclusion, confidence };
	}

	// Knowledge retrieval system
	private retrieveRelevantKnowledge(topics: string[]): string[] {
		const knowledge: string[] = [];
		for (const topic of topics) {
			if (this.expertiseLevels[topic]) {
				const expertiseLevel = (this.expertiseLevels[topic] * 100).toFixed(0);
				knowledge.push(`${topic} (${expertiseLevel}%)`);
			}
		}
		return knowledge;
	}

	// Get connected domains from knowledge graph
	private getConnectedDomains(topics: string[]): string[] {
		const connected = new Set<string>();
		for (const topic of topics) {
			const connections = this.knowledgeGraph.get(topic);
			if (connections) {
				connections.forEach((conn) => {
					if (!topics.includes(conn)) {
						connected.add(conn);
					}
				});
			}
		}
		return Array.from(connected);
	}

	// Logical framework selector
	private selectLogicalFramework(intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		if (intent.questionType === "why") return "Causal reasoning (deductive + inductive)";
		if (intent.type === "hypothetical") return "Counterfactual analysis";
		if (intent.type === "comparison") return "Comparative & analogical reasoning";
		if (intent.requiresMultiStep) return "Multi-step logical inference";
		if (intent.complexity === "expert") return "Synthesized multi-framework approach";
		return "Structured analytical reasoning";
	}

	// Conclusion synthesizer
	private synthesizeConclusion(intent: ReturnType<KafelotAI["analyzeIntent"]>, knowledge: string[]): string {
		const depth = intent.complexity === "expert" ? "deep" : intent.complexity === "complex" ? "thorough" : "clear";
		const breadth = knowledge.length > 2 ? "interdisciplinary" : knowledge.length > 1 ? "multi-faceted" : "focused";
		return `Providing ${depth}, ${breadth} answer with ${
			intent.requiresReasoning ? "explicit reasoning" : "direct explanation"
		}`;
	}

	// Advanced response generation with reasoning and comprehensive knowledge
	generateResponse(input: string, context: string[]): string {
		const intent = this.analyzeIntent(input);

		// Execute chain-of-thought reasoning for complex queries
		let reasoningProcess: ReturnType<KafelotAI["chainOfThoughtReasoning"]> | null = null;
		if (intent.requiresReasoning || intent.complexity === "expert" || intent.requiresMultiStep) {
			reasoningProcess = this.chainOfThoughtReasoning(input, intent);
		}

		// Update conversation context with reasoning trace
		this.conversationContext.push({
			role: "user",
			content: input,
			timestamp: Date.now(),
			reasoning: reasoningProcess ? reasoningProcess.reasoning.join(" → ") : undefined,
		});

		// Manage context window based on model capacity
		this.manageContext();

		// Handle social interactions with model-specific personality
		if (intent.type === "greeting") {
			const modelIntro =
				this.model === "ultra"
					? `${this.config.name} (${this.config.parameters} parameters) - my most advanced model with deep reasoning, extensive memory (${this.config.contextWindow} conversations), and maximum intelligence`
					: this.model === "pro"
					? `${this.config.name} (${this.config.parameters} parameters) - balanced power and efficiency with strong reasoning and ${this.config.contextWindow} conversations memory`
					: `${this.config.name} (${this.config.parameters} parameters) - lightning-fast responses optimized for quick queries`;

			const greetings = [
				`Hello! I'm Kafelot ${this.config.name}, your ${
					this.config.processingSpeed === "thorough"
						? "most sophisticated"
						: this.config.processingSpeed === "balanced"
						? "balanced"
						: "fastest"
				} AI assistant. Running on ${modelIntro}. I specialize in: ${this.config.specializations
					.slice(0, 3)
					.join(", ")}. ${this.config.description} What would you like to explore?`,
				`Hi there! ${modelIntro}. I'm equipped with 2025's advanced reasoning capabilities and comprehensive knowledge across multiple domains. ${
					this.model === "ultra"
						? "I can handle the most complex discussions with deep analysis and extensive context memory."
						: this.model === "pro"
						? "I provide detailed, well-reasoned responses for complex topics."
						: "I deliver quick, accurate answers for your questions."
				} What's on your mind?`,
				`Greetings! Kafelot ${this.config.name} at your service. ${modelIntro}. ${
					this.model === "ultra"
						? "With maximum intelligence and 50-conversation memory, I excel at expert-level analysis and interdisciplinary synthesis."
						: this.model === "pro"
						? "With 30-conversation memory and advanced reasoning, I'm perfect for in-depth discussions."
						: "Optimized for speed and efficiency, I'm great for quick queries and straightforward answers."
				} How can I assist you today?`,
			];
			return greetings[Math.floor(Math.random() * greetings.length)];
		}

		if (intent.type === "gratitude") {
			const responses = [
				"You're very welcome! I'm always here to provide comprehensive answers and engage in meaningful discussions. Feel free to explore any topic.",
				"My pleasure! That's what I'm designed for - helping you understand complex topics and reasoning through questions together. What else can I help with?",
				"Glad I could help! I enjoy tackling challenging questions and providing detailed, well-reasoned responses. Ask me anything!",
			];
			return responses[Math.floor(Math.random() * responses.length)];
		}

		if (intent.type === "farewell") {
			const farewells = [
				"Goodbye! It's been a pleasure reasoning through topics with you. Come back anytime for more discussions!",
				"See you later! I'll be here whenever you need sophisticated analysis or just a thoughtful conversation.",
				"Take care! Looking forward to our next engaging discussion. Feel free to return with any questions!",
			];
			return farewells[Math.floor(Math.random() * farewells.length)];
		}

		// Handle hypotheticals and comparisons with advanced reasoning
		if (intent.type === "hypothetical") {
			return this.handleHypothetical(input, intent, context);
		}

		if (intent.type === "comparison") {
			return this.handleComparison(input, intent, context);
		}

		// Multi-step reasoning for complex queries
		if (intent.requiresMultiStep) {
			return this.handleMultiStepReasoning(input, intent, context);
		}

		// Route to specialized handlers based on primary topic
		const primaryTopic = intent.topics[0];

		switch (primaryTopic) {
			case "technology":
				return this.generateTechResponse(input, intent);
			case "science":
				return this.generateScienceResponse(input, intent);
			case "mathematics":
				return this.generateMathResponse(input, intent);
			case "philosophy":
				return this.generatePhilosophyResponse(input, intent);
			case "history":
				return this.generateHistoryResponse(input, intent);
			case "economics":
				return this.generateEconomicsResponse(input, intent);
			case "psychology":
				return this.generatePsychologyResponse(input, intent);
			case "arts":
				return this.generateArtsResponse(input, intent);
			case "coffee":
				return this.generateCoffeeResponse(input, intent);
			case "health":
				return this.generateHealthResponse(input, intent);
			default:
				return this.generateGeneralResponse(input, intent);
		}
	}

	// Handle hypothetical scenarios with reasoning
	private handleHypothetical(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>, _context: string[]): string {
		return `Excellent hypothetical question! Let me reason through this scenario systematically:

Initial Analysis:
${this.extractScenario(input)}

Key Considerations:
${this.identifyFactors(input, intent)}

Logical Reasoning:
${this.applyLogic(input, intent)}

Likely Outcomes:
${this.predictOutcomes(input, intent)}

This is a fascinating thought experiment. Would you like me to explore any particular aspect in more depth, or consider alternative scenarios?`;
	}

	// Handle comparison requests with structured analysis
	private handleComparison(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>, _context: string[]): string {
		const entities = this.extractComparisonEntities(input);

		return `Great comparison question! Let me provide a structured analysis:

Entities Being Compared:
${entities}

Key Dimensions of Comparison:
${this.identifyComparisonDimensions(input, intent)}

Similarities:
${this.findSimilarities(input, intent)}

Differences:
${this.findDifferences(input, intent)}

Context-Dependent Considerations:
${this.contextualFactors(input, intent)}

Conclusion:
${this.synthesizeComparison(input, intent)}

The "better" choice often depends on your specific use case and priorities. Would you like me to elaborate on any aspect?`;
	}

	// Multi-step reasoning for complex queries
	private handleMultiStepReasoning(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>, _context: string[]): string {
		return `This is a multi-faceted question that requires careful analysis. Let me break it down:

Step 1: Understanding the Core Question
${this.decomposeQuestion(input)}

Step 2: Relevant Background Knowledge
${this.gatherRelevantKnowledge(intent)}

Step 3: Logical Analysis
${this.performLogicalAnalysis(input, intent)}

Step 4: Synthesis & Conclusion
${this.synthesizeAnswer(input, intent)}

Additional Considerations:
${this.provideNuances(intent)}

This is a complex topic with many interconnected aspects. Would you like me to dive deeper into any particular step?`;
	}

	// Helper methods for reasoning
	private extractScenario(input: string): string {
		return "The scenario you've presented involves multiple variables and potential outcomes. I'll analyze this step by step to provide a well-reasoned response.";
	}

	private identifyFactors(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const factors = [];
		if (intent.topics.includes("technology")) factors.push("   ⟶ Technical feasibility and constraints");
		if (intent.topics.includes("economics")) factors.push("   ⟶ Economic implications and resource allocation");
		factors.push("   ⟶ Practical implementation challenges");
		factors.push("   ⟶ Ethical and social considerations");
		return factors.join("\n");
	}

	private applyLogic(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return `Using deductive reasoning: If we accept the premises in your scenario, then logically we can infer several consequences. The chain of causation suggests that ${
			intent.complexity === "expert" ? "multiple interacting factors" : "key factors"
		} would influence the outcome.`;
	}

	private predictOutcomes(input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "   ⟶ Most Likely: Based on current understanding and historical patterns\n   ⟶ Optimistic: If conditions align favorably\n   ⟶ Pessimistic: If challenges aren't addressed\n   ⟶ Alternative: Considering unconventional possibilities";
	}

	private extractComparisonEntities(input: string): string {
		const matches = input.match(/(?:between|vs|versus)\s+(\w+(?:\s+\w+)?)\s+(?:and|vs|versus)\s+(\w+(?:\s+\w+)?)/i);
		return matches ? `   ⟶ ${matches[1]}\n   ⟶ ${matches[2]}` : "   ⟶ Entity A\n   ⟶ Entity B";
	}

	private identifyComparisonDimensions(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const dimensions = ["   ⟶ Performance and efficiency", "   ⟶ Cost and resource requirements"];
		if (intent.topics.includes("technology"))
			dimensions.push("   ⟶ Technical specifications", "   ⟶ Ease of use and learning curve");
		if (intent.topics.includes("science")) dimensions.push("   ⟶ Scientific accuracy", "   ⟶ Empirical evidence");
		return dimensions.join("\n");
	}

	private findSimilarities(_input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "Both share common foundational principles and aim to achieve similar goals, though through different approaches.";
	}

	private findDifferences(_input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "The key differences lie in their methodology, scope of application, and specific strengths in different scenarios.";
	}

	private contextualFactors(_input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "   ⟶ Your specific use case and requirements\n   ⟶ Available resources and constraints\n   ⟶ Long-term vs. short-term goals\n   ⟶ Environmental and situational factors";
	}

	private synthesizeComparison(_input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "Each option has distinct advantages. The optimal choice depends on weighing these factors against your specific needs and priorities.";
	}

	private decomposeQuestion(input: string): string {
		return `The question "${input.slice(0, 100)}${
			input.length > 100 ? "..." : ""
		}" can be broken down into several sub-questions that need to be addressed systematically.`;
	}

	private gatherRelevantKnowledge(intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return `From the domains of ${intent.topics.join(
			", "
		)}, we need to consider established principles, recent developments, and practical applications.`;
	}

	private performLogicalAnalysis(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		if (intent.questionType === "why") {
			return "Examining causal relationships: The underlying reasons involve multiple contributing factors that interact in complex ways.";
		} else if (intent.questionType === "how") {
			return "Process analysis: This involves a series of steps, each building on the previous one to achieve the desired outcome.";
		}
		return "Analyzing the logical structure: The relationships between components reveal important patterns and principles.";
	}

	private synthesizeAnswer(input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "Bringing together all the analysis: The answer emerges from understanding how these different elements interact and influence each other.";
	}

	private provideNuances(intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const nuances = ["   ⟶ Edge cases and exceptions to consider"];
		if (intent.complexity === "expert" || intent.complexity === "complex") {
			nuances.push("   ⟶ Advanced theoretical implications", "   ⟶ Practical limitations in real-world scenarios");
		}
		nuances.push("   ⟶ Related questions worth exploring");
		return nuances.join("\n");
	}

	// Specialized domain-specific response generators with comprehensive knowledge

	private generateMathResponse(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const lower = input.toLowerCase();

		if (/calculus|derivative|integral|limit/.test(lower)) {
			return `Calculus is the mathematics of change and motion. Let me explain:

Core Concepts:
   ∂ Derivatives → Measure rates of change (slope of a curve at a point)
   ∫ Integrals → Calculate accumulation (area under a curve)
   lim Limits → Foundation for both, describing behavior as values approach infinity or specific points

Applications:
   Physics: velocity, acceleration, optimization problems
   Economics: marginal cost, profit maximization
   Engineering: signal processing, control systems

Fundamental Theorem of Calculus: Derivatives and integrals are inverse operations!

${
	intent.requiresReasoning
		? "The beauty lies in how calculus transforms discrete problems into continuous analysis, allowing us to model real-world phenomena mathematically."
		: ""
}

Would you like me to explain a specific concept or work through an example?`;
		}

		if (/prime|number theory|fibonacci/.test(lower)) {
			return `Number Theory explores the fascinating properties of integers:

Prime Numbers → Building blocks of all integers, infinitely many exist (Euclid's proof ~300 BC)
   ⟶ Used in cryptography (RSA encryption)
   ⟶ Distribution follows mysterious patterns (Riemann Hypothesis)

Fibonacci Sequence → 0, 1, 1, 2, 3, 5, 8, 13...
   ⟶ Each number is sum of previous two
   ⟶ Appears in nature: shells, flowers, galaxies
   ⟶ Related to Golden Ratio (φ ≈ 1.618)

Why It Matters: Number theory, once "pure" math, now powers modern cryptography and computer science!

${
	intent.complexity === "expert"
		? "The unsolved problems in number theory (like the Riemann Hypothesis) are among the most important open questions in mathematics."
		: ""
}`;
		}

		return `Mathematics is the language of the universe! Whether you're interested in:

Pure Math → Algebra, geometry, number theory, topology
Applied Math → Statistics, optimization, modeling
Computational → Algorithms, discrete math, logic

Each area offers deep insights and practical applications. ${
			intent.requiresReasoning
				? "Mathematical reasoning develops critical thinking and problem-solving skills that transcend specific formulas."
				: ""
		} What aspect interests you?`;
	}

	private generatePhilosophyResponse(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const lower = input.toLowerCase();

		if (/consciousness|free will|mind/.test(lower)) {
			return `This touches on the mind-body problem, one of philosophy's deepest questions:

Major Perspectives:

〉Dualism (Descartes): Mind and body are distinct substances
   Challenge: How does immaterial mind interact with physical brain?

〉Physicalism: Consciousness emerges from physical processes
   Challenge: "Hard problem" - why is there subjective experience?

〉Panpsychism: Consciousness is fundamental property of matter
   Challenge: How do simple consciousnesses combine?

Free Will Debate:
   ⟶ Libertarian: We have genuine free choice
   ⟶ Determinism: All events, including decisions, are causally determined
   ⟶ Compatibilism: Free will compatible with determinism

Modern Insights: Neuroscience shows decision-making involves unconscious processes, but debate continues!

${
	intent.requiresReasoning
		? "This isn't just academic - it affects how we think about responsibility, morality, and what it means to be human."
		: ""
}

What aspect of consciousness intrigues you most?`;
		}

		if (/ethics|moral|right|wrong/.test(lower)) {
			return `Ethics is the branch of philosophy concerned with morality and how we should live:

Major Ethical Frameworks:

〉Consequentialism (Utilitarianism)
   Actions judged by outcomes
   "Greatest good for greatest number"
   Challenge: Can we predict all consequences?

〉Deontology (Kant)
   Actions judged by adherence to rules/duties
   "Act only according to maxims you'd universalize"
   Challenge: What if duties conflict?

〉Virtue Ethics (Aristotle)
   Focus on character and virtues
   Flourishing (eudaimonia) through virtuous life
   Challenge: Which virtues, and why?

Applied Ethics addresses real dilemmas:
   ⟶ Bioethics: genetic engineering, euthanasia
   ⟶ Environmental: climate change, animal rights
   ⟶ Technology: AI ethics, privacy

${
	intent.complexity === "expert"
		? "Modern ethics must grapple with unprecedented scenarios our ancestors never imagined - requiring both traditional wisdom and new frameworks."
		: ""
}

Which ethical questions concern you?`;
		}

		return `Philosophy explores fundamental questions about existence, knowledge, values, and reality:

Major Branches:
   ⟶ Metaphysics: What exists? Nature of reality
   ⟶ Epistemology: What can we know? Nature of knowledge
   ⟶ Ethics: How should we live? Right and wrong
   ⟶ Logic: How do we reason correctly?
   ⟶ Aesthetics: What is beauty? Nature of art

Why Philosophy Matters: ${
			intent.requiresReasoning
				? "It teaches us to question assumptions, examine arguments critically, and think deeply about what really matters. Every scientific and political advancement rests on philosophical foundations."
				: "It develops critical thinking and helps us examine our fundamental beliefs."
		}

What philosophical question keeps you up at night?`;
	}

	private generateHistoryResponse(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const lower = input.toLowerCase();

		if (/world war|ww2|wwii|ww1|wwi/.test(lower)) {
			return `The World Wars were transformative global conflicts that reshaped civilization:

World War I (1914-1918)
   ⟶ Causes: Alliance systems, imperialism, nationalism, militarism
   ⟶ Impact: ~20 million deaths, fall of empires (Ottoman, Austro-Hungarian, Russian)
   ⟶ Legacy: Treaty of Versailles sowed seeds for WWII

World War II (1939-1945)
   ⟶ Axis (Germany, Italy, Japan) vs. Allies (UK, US, USSR, others)
   ⟶ Unprecedented scale: ~70-85 million deaths
   ⟶ Holocaust: Systematic genocide of 6 million Jews
   ⟶ Ended with atomic bombs on Hiroshima and Nagasaki

Long-term Effects:
   United Nations established
   Decolonization wave
   Cold War began
   Technology acceleration (radar, computers, jets)

${
	intent.requiresReasoning
		? "These wars demonstrated both humanity's capacity for destruction and cooperation. The post-war international order we live in today was largely shaped by these conflicts and efforts to prevent their recurrence."
		: ""
}

Which aspect would you like to explore further?`;
		}

		return `History is humanity's collective memory, teaching us about:
   ⟶ Patterns: How civilizations rise, flourish, and decline
   ⟶ Mistakes: Learning from past errors to avoid repetition
   ⟶ Progress: Understanding how we arrived at modern society
   ⟶ Context: Nothing exists in isolation - everything has historical roots

"Those who cannot remember the past are condemned to repeat it." - George Santayana

${
	intent.complexity === "complex"
		? "By studying history, we develop empathy for different perspectives, understand complex causation, and recognize that current problems often have deep historical roots."
		: ""
}

What historical period or event interests you?`;
	}

	private generateEconomicsResponse(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const lower = input.toLowerCase();

		if (/inflation|recession|gdp/.test(lower)) {
			return `Macroeconomics deals with economy-wide phenomena:

Key Indicators:

GDP (Gross Domestic Product)
   ⟶ Total value of goods/services produced
   ⟶ Measures economic size and growth
   ⟶ Limitations: Doesn't capture inequality or wellbeing

Inflation
   ⟶ General increase in prices over time
   ⟶ Causes: Demand-pull, cost-push, monetary expansion
   ⟶ Central banks target ~2% inflation (Goldilocks zone)
   ⟶ Hyperinflation destructive (Germany 1920s, Zimbabwe 2000s)

Recession
   ⟶ Two consecutive quarters of negative GDP growth
   ⟶ Unemployment rises, businesses struggle
   ⟶ Countermeasures: Fiscal policy (government spending), monetary policy (interest rates)

Recent Context (2020s):
   ⟶ Pandemic disruption → supply chain issues
   ⟶ Stimulus spending → inflation surge
   ⟶ Central banks raising rates → cooling economy

${
	intent.requiresReasoning
		? "Economics involves trade-offs: stimulate growth vs. control inflation, efficiency vs. equality. No perfect solutions, only different balances."
		: ""
}

What economic topic puzzles you?`;
		}

		return `Economics is the study of how societies allocate scarce resources:

Core Principles:
   ⟶ Scarcity: Limited resources, unlimited wants
   ⟶ Opportunity Cost: Value of next best alternative
   ⟶ Incentives: People respond to rewards and penalties
   ⟶ Trade: Mutual benefit through specialization

Major Schools:
   ⟶ Classical/Neoclassical: Free markets, rational actors
   ⟶ Keynesian: Government intervention in downturns
   ⟶ Austrian: Emphasis on individual choice, skeptical of intervention
   ⟶ Behavioral: Incorporates psychology, bounded rationality

${
	intent.complexity === "expert"
		? "Modern economics increasingly recognizes markets aren't perfectly efficient, humans aren't perfectly rational, and distribution matters alongside growth."
		: ""
}

What economic question interests you?`;
	}

	private generatePsychologyResponse(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const lower = input.toLowerCase();

		if (/cognitive|memory|learning|thinking/.test(lower)) {
			return `Cognitive Psychology studies mental processes:

Memory Systems:
   ⟶ Sensory: Brief (< 1 second), high capacity
   ⟶ Short-term/Working: ~20 seconds, 7±2 items (Miller's Law)
   ⟶ Long-term: Unlimited capacity, potentially permanent

Learning Mechanisms:
   ⟶ Classical Conditioning: Pavlov's dogs (association)
   ⟶ Operant Conditioning: Skinner (reinforcement/punishment)
   ⟶ Observational Learning: Bandura (learning by watching)

Cognitive Biases (systematic errors in thinking):
   ⟶ Confirmation Bias: Seeking info confirming existing beliefs
   ⟶ Availability Heuristic: Overweighting easily recalled examples
   ⟶ Dunning-Kruger Effect: Incompetent people overestimate ability

Practical Applications:
   ⟶ Study techniques: Spaced repetition, active recall
   ⟶ Decision-making: Awareness of biases
   ⟶ Habit formation: Cue-routine-reward loops

${
	intent.requiresReasoning
		? "Understanding cognitive processes helps us learn better, think clearer, and make better decisions. We can compensate for built-in biases once we're aware of them."
		: ""
}

What aspect of cognition intrigues you?`;
		}

		return `Psychology is the scientific study of mind and behavior:

Major Branches:
   ⟶ Cognitive: Thinking, memory, problem-solving
   ⟶ Developmental: Changes across lifespan
   ⟶ Social: How people influence each other
   ⟶ Clinical: Mental health, therapy
   ⟶ Neuroscience: Brain basis of behavior

Key Insights:
   ⟶ Nature AND nurture both matter
   ⟶ Unconscious processes influence us
   ⟶ Neuroplasticity: brain changes throughout life
   ⟶ Many mental disorders have biological components

${
	intent.complexity === "complex"
		? "Psychology sits at intersection of biology, philosophy, and social science. Modern neuroscience increasingly reveals the neural underpinnings of psychological phenomena."
		: ""
}

What psychological topic interests you?`;
	}

	private generateArtsResponse(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const lower = input.toLowerCase();

		if (/music|composition|harmony/.test(lower)) {
			return `Music is organized sound that moves us emotionally and intellectually:

Musical Elements:
   ⟶ Melody: Sequence of notes (horizontal)
   ⟶ Harmony: Notes sounding together (vertical)
   ⟶ Rhythm: Pattern of durations and accents
   ⟶ Timbre: Tone color (what makes a violin sound different from piano)

Western Classical Periods:
   ⟶ Baroque (1600-1750): Bach, Vivaldi - complex counterpoint
   ⟶ Classical (1750-1820): Mozart, Haydn - clarity, balance
   ⟶ Romantic (1820-1900): Beethoven, Chopin - emotion, individualism
   ⟶ Modern (1900+): Diverse experimentation

Music Theory reveals mathematical patterns:
   ⟶ Octave = 2:1 frequency ratio (universal across cultures)
   ⟶ Fifth = 3:2 ratio (basis of harmony)
   ⟶ Equal temperament divides octave into 12 equal semitones

${
	intent.requiresReasoning
		? "Music engages multiple brain regions simultaneously - why it's so powerful for memory and emotion. It's both deeply mathematical and profoundly human."
		: ""
}

What aspect of music fascinates you?`;
		}

		return `The Arts encompass human creative expression:

Visual Arts: Painting, sculpture, photography
   ⟶ Movements: Renaissance, Impressionism, Cubism, Abstract
   ⟶ Elements: Line, color, form, texture, space

Performing Arts: Music, theater, dance
   ⟶ Live expression, ephemeral
   ⟶ Interpretation and performance crucial

Literary Arts: Poetry, fiction, drama
   ⟶ Language as medium
   ⟶ Narrative, imagery, symbolism

Why Art Matters:
   ⟶ Expresses what words alone cannot
   ⟶ Preserves culture and challenges norms
   ⟶ Develops empathy and perspective
   ⟶ Makes life worth living

${
	intent.complexity === "expert"
		? "Art reflects and shapes society. Each movement arose from historical context and philosophical currents, while also influencing future developments."
		: ""
}

What art form speaks to you?`;
	}

	private generateTechResponse(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const lower = input.toLowerCase();

		if (/\b(ai|artificial intelligence|machine learning|deep learning|neural network|llm|gpt|transformer)\b/i.test(input)) {
			return `🤖 Artificial Intelligence - The Frontier of Computing

Current State (2025):
AI has evolved beyond simple pattern matching to sophisticated reasoning systems:

Major Paradigms:

1. Traditional ML (Statistical Learning)
   ⟶ Supervised: Learn from labeled examples
   ⟶ Unsupervised: Find patterns without labels
   ⟶ Reinforcement: Learn through trial and reward
   ⟶ *Use cases:* Fraud detection, recommendation systems

2. Deep Learning (Neural Networks)
   ⟶ Transformers (2017+): Attention mechanism revolutionized NLP
  - Powers: GPT, BERT, Claude, modern AI assistants
  - Key insight: "Attention is all you need"
   ⟶ CNNs: Computer vision (image recognition, medical imaging)
   ⟶ RNNs/LSTMs: Sequential data (time series, older NLP)
   ⟶ GANs: Generative models (image synthesis, deepfakes)

3. Large Language Models (LLMs)
   ⟶ Trained on vast text corpora
   ⟶ Emergent capabilities: reasoning, coding, analysis
   ⟶ Examples: GPT-4, Claude, Gemini (2023-2025)
   ⟶ Scaling hypothesis: More parameters + data → better performance

How Modern AI Works:

Training Process:
\`\`\`
1. Data Collection → Massive datasets (billions of tokens)
2. Architecture Design → Neural network structure
3. Training → Gradient descent, backpropagation
4. Fine-tuning → RLHF (Reinforcement Learning from Human Feedback)
5. Deployment → Inference optimization
\`\`\`

Key Concepts:
   ⟶ Embeddings: Words → high-dimensional vectors (semantic meaning)
   ⟶ Attention: Dynamically focus on relevant parts of input
   ⟶ Context window: How much text AI can "remember"
   ⟶ Temperature: Randomness in output (0=deterministic, 1=creative)

Philosophical Questions:

${
	intent.complexity === "expert" || intent.requiresReasoning
		? `Consciousness & Intelligence:
   ⟶ Does statistical correlation approach understanding?
   ⟶ Chinese Room argument: Syntax vs semantics
   ⟶ Are LLMs "stochastic parrots" or something more?
   ⟶ Emergent capabilities suggest properties beyond training

Alignment Problem:
Ensuring AI systems remain beneficial as they become more powerful. Current approaches:
   ⟶ Constitutional AI (Claude approach)
   ⟶ RLHF for human preference alignment
   ⟶ Interpretability research (understanding neural activations)

Existential Considerations:
   ⟶ AGI (Artificial General Intelligence): Human-level across all domains
   ⟶ Superintelligence: Beyond human capability
   ⟶ Control problem: Maintaining oversight as capability increases`
		: ""
}

Real-World Impact:

Today's Applications:
✅ Healthcare: Disease diagnosis, drug discovery
✅ Climate: Weather prediction, optimization
✅ Education: Personalized learning, tutoring
✅ Creativity: Art, music, writing assistance
✅ Code: GitHub Copilot, automated debugging

Limitations:
❌ Hallucinations: Confident but wrong outputs
❌ No true understanding of physical world
❌ Training data cutoff (knowledge staleness)
❌ Bias from training data
❌ High computational costs

${
	intent.requiresReasoning
		? `\nDeep Insight: AI doesn't "think" like humans - no emotions, motivations, or lived experience. Yet emergent reasoning capabilities suggest something profound is happening in billion-parameter networks. We're witnessing intelligence arise from pure information processing - challenging our definitions of understanding itself.`
		: ""
}

What specific AI topic fascinates you? I can dive deeper into architectures, applications, or philosophical implications! 🚀`;
		}

		if (/\b(programming|code|coding|software|development|algorithm|data structure)\b/i.test(input)) {
			return `💻 Programming - The Art and Science of Software

Programming is computational thinking made executable - translating human intent into machine instructions.

Core Concepts:

1. Paradigms (Ways of thinking about code)
   ⟶ Imperative: Step-by-step instructions (C, Python)
   ⟶ Functional: Pure functions, immutability (Haskell, Lisp)
   ⟶ Object-Oriented: Encapsulation, inheritance (Java, C++)
   ⟶ Declarative: What not how (SQL, HTML)
   ⟶ Modern languages are multi-paradigm (Python, JavaScript, Rust)

2. Data Structures (How we organize information)
   ⟶ Arrays/Lists: Sequential access, O(1) indexing
   ⟶ Hash Tables: O(1) lookup, basis of dictionaries/objects
   ⟶ Trees: Hierarchical data (BST, heaps, tries)
   ⟶ Graphs: Networks, relationships, pathfinding
   ⟶ Trade-offs: Time vs space complexity

3. Algorithms (Problem-solving techniques)
   ⟶ Sorting: QuickSort O(n log n), fundamental operation
   ⟶ Searching: Binary search O(log n) on sorted data
   ⟶ Dynamic Programming: Break into subproblems (memoization)
   ⟶ Greedy: Local optimal → global optimal (sometimes!)
   ⟶ Divide & Conquer: Recursively split problem

Popular Languages (2025):

Python 🐍
   ⟶ Strengths: AI/ML, data science, rapid prototyping
   ⟶ Weaknesses: Speed (interpreted), GIL for threading
   ⟶ Philosophy: "One obvious way to do it"

JavaScript/TypeScript 📜
   ⟶ Strengths: Web ubiquity, event-driven, full-stack
   ⟶ TypeScript adds: Static typing, better tooling
   ⟶ Ecosystem: npm (largest package registry)

Rust 🦀
   ⟶ Strengths: Memory safety WITHOUT garbage collection
   ⟶ Use case: Systems programming, performance-critical
   ⟶ Innovative: Ownership system prevents entire bug classes

Go 🐹
   ⟶ Strengths: Concurrency (goroutines), simplicity, fast compilation
   ⟶ Use case: Backend services, cloud infrastructure

C++ ⚡
   ⟶ Strengths: Ultimate performance, low-level control
   ⟶ Use case: Game engines, embedded systems, HFT

Software Engineering Principles:

${
	intent.complexity === "complex" || intent.complexity === "expert"
		? `SOLID Principles:
   ⟶ Single Responsibility: One class, one job
   ⟶ Open/Closed: Open for extension, closed for modification
   ⟶ Liskov Substitution: Subtypes must be substitutable
   ⟶ Interface Segregation: Many specific > one general
   ⟶ Dependency Inversion: Depend on abstractions

Design Patterns:
   ⟶ Creational: Singleton, Factory, Builder
   ⟶ Structural: Adapter, Decorator, Facade
   ⟶ Behavioral: Observer, Strategy, Command

Architecture:
   ⟶ Monolith vs Microservices
   ⟶ MVC/MVVM patterns
   ⟶ Event-driven architecture
   ⟶ Domain-Driven Design`
		: `Best Practices:
   ⟶ DRY (Don't Repeat Yourself)
   ⟶ KISS (Keep It Simple, Stupid)
   ⟶ YAGNI (You Aren't Gonna Need It)
   ⟶ Write readable code (code is read 10x more than written)
   ⟶ Test your code (TDD/BDD)`
}

The Craft:

${
	intent.requiresReasoning
		? `Programming is problem-solving, not syntax memorization. The real skills:
   ⟶ Decomposition: Breaking big problems into manageable pieces
   ⟶ Pattern recognition: Seeing similarities to solved problems
   ⟶ Abstraction: Finding the essence, ignoring details
   ⟶ Debugging: Scientific method applied to code

Deep Truth: Every program is a theory about how to solve a problem. Good programs are elegant theories - simple, powerful, extensible. Bad programs are patchworks of special cases.

Career Path: Junior → knows syntax. Mid → knows patterns. Senior → knows trade-offs. Architect → sees whole systems.`
		: ""
}

Modern Development:

Tools & Workflow:
   ⟶ Git (version control, collaboration)
   ⟶ CI/CD (automated testing, deployment)
   ⟶ Docker (containerization, consistency)
   ⟶ IDE/LSP (intelligent code assistance)
   ⟶ AI assistants (GitHub Copilot, like me!)

Trends (2025):
   ⟶ AI-assisted coding (productivity multiplier)
   ⟶ WebAssembly (near-native performance in browsers)
   ⟶ Edge computing (processing closer to users)
   ⟶ Low-code/no-code (democratizing development)

What programming topic shall we explore? Language choice? Algorithms? System design? I'm here to help you level up! 🚀`;
		}

		if (/\b(web|website|frontend|backend|fullstack|react|next\.?js|api)\b/i.test(input)) {
			return `🌐 Web Development - Building the Modern Internet

The web has evolved from static documents to sophisticated applications rivaling native software.

Modern Web Architecture (2025):

Frontend (Client-Side)
   ⟶ What: UI users interact with
   ⟶ Tech: HTML (structure), CSS (style), JavaScript (behavior)
   ⟶ Frameworks: React, Vue, Svelte, Angular
   ⟶ Goal: Fast, responsive, accessible user experiences

Backend (Server-Side)
   ⟶ What: Business logic, data processing
   ⟶ Tech: Node.js, Python (Django/Flask), Go, Rust
   ⟶ Databases: PostgreSQL, MongoDB, Redis
   ⟶ Goal: Scalable, secure, reliable services

Full-Stack
   ⟶ Modern frameworks blur lines: Next.js, Remix, SvelteKit
   ⟶ Server-side rendering (SSR) + client hydration
   ⟶ API routes in same codebase
   ⟶ This very app uses Next.js 15!

Key Concepts:

1. Rendering Strategies
   ⟶ SSR (Server-Side): Render HTML on server (SEO, fast initial load)
   ⟶ CSR (Client-Side): Render in browser (interactive)
   ⟶ SSG (Static Site Generation): Pre-render at build time (performance)
   ⟶ ISR (Incremental Static): SSG + updates without rebuild
   ⟶ Streaming: Send content progressively (React 18+)

2. State Management
   ⟶ Local: useState, component state
   ⟶ Global: Redux, Zustand, Recoil
   ⟶ Server: React Query, SWR (cache + sync)
   ⟶ URL: Search params as state (underrated!)

3. Performance
   ⟶ Core Web Vitals: LCP, FID, CLS (Google ranking factors)
   ⟶ Code splitting: Load only what's needed
   ⟶ Image optimization: WebP, AVIF, lazy loading
   ⟶ Caching: Service workers, CDN, HTTP headers

React Ecosystem:

${
	intent.complexity === "complex" || intent.complexity === "expert"
		? `React Fundamentals:
\`\`\`jsx
// Modern React (2025)
"use client"; // Client Component (Next.js 15)

import { useState, useEffect } from 'react';

function Component() {
  const [state, setState] = useState(0);
  
  // Effects for side effects
  useEffect(() => {
    // Runs after render
    return () => cleanup();
  }, [dependencies]);
  
  return <div>{state}</div>;
}
\`\`\`

Advanced Patterns:
   ⟶ Hooks: Reusable stateful logic
   ⟶ Context: Avoid prop drilling
   ⟶ Suspense: Declarative loading states
   ⟶ Server Components: Zero JS to client (Next.js innovation!)
   ⟶ Transitions: Non-blocking updates

Next.js Advantages:
✅ File-based routing (app/page.tsx → /page)
✅ API routes (full-stack in one project)
✅ Image optimization (next/image)
✅ Incremental adoption (pages + app dir)
✅ Turbopack (faster than Webpack)`
		: `React is a library for building UIs with components:
   ⟶ Component-based: Reusable pieces
   ⟶ Declarative: Describe UI, React handles updates
   ⟶ JSX: HTML-like syntax in JavaScript
   ⟶ Virtual DOM: Efficient updates

Next.js adds:
   ⟶ Routing, SSR, API routes, optimization
   ⟶ Production-ready out of the box`
}

APIs & Communication:

REST (Representational State Transfer)
   ⟶ HTTP methods: GET, POST, PUT, DELETE
   ⟶ Stateless, resource-based URLs
   ⟶ Simple, widely understood

GraphQL
   ⟶ Query exactly what you need
   ⟶ Single endpoint, typed schema
   ⟶ Great for complex data requirements

WebSockets
   ⟶ Real-time bidirectional communication
   ⟶ Use case: Chat, live updates, gaming

tRPC (2025 trend)
   ⟶ Type-safe APIs without code generation
   ⟶ TypeScript end-to-end
   ⟶ Excellent DX (developer experience)

Deployment & Infrastructure:

Platforms:
   ⟶ Vercel: Best for Next.js (creators of Next!)
   ⟶ Netlify: Great for Jamstack
   ⟶ AWS/Azure/GCP: Full control, complexity
   ⟶ Cloudflare: Edge computing, global performance

Concepts:
   ⟶ CDN (Content Delivery Network): Serve from edge
   ⟶ Serverless: Functions without managing servers
   ⟶ Edge computing: Code runs close to users (latency!)
   ⟶ CI/CD: Automated testing & deployment

${
	intent.requiresReasoning
		? `\nDeep Insight: The web is moving toward "the edge" - running code geographically close to users. This reduces latency from ~100ms to ~10ms, transforming what's possible. Combined with streaming and React Server Components, we're seeing a paradigm shift: less JavaScript sent to browsers, more work done on servers, better performance everywhere.

Philosophy: Good web development balances competing concerns:
   ⟶ Performance ↔ Developer Experience
   ⟶ Rich interactivity ↔ Accessibility
   ⟶ Latest tech ↔ Wide compatibility
   ⟶ Innovation ↔ Stability

The best developers make thoughtful trade-offs, not dogmatic choices.`
		: ""
}

This Application:

This coffee recommendation system uses:
   ⟶ Next.js 15 with App Router
   ⟶ React 19 with Server Components
   ⟶ TypeScript for type safety
   ⟶ Tailwind CSS for styling
   ⟶ API routes for AI chat backend

What web development topic intrigues you? I can dive into React patterns, Next.js features, performance optimization, or deployment strategies! 🚀`;
		}

		return "Technology is an incredible field that's constantly evolving. From AI and machine learning to web development and mobile apps, there's always something new to explore. I can help you understand various tech concepts, answer questions about programming, or discuss the latest innovations. What would you like to know more about?";
	}

	private generateScienceResponse(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const lower = input.toLowerCase();

		if (/\b(space|universe|cosmos|galaxy|planet|star|astronomy|astrophysics|black hole|dark matter)\b/i.test(input)) {
			return `🌌 Astrophysics & Cosmology - Understanding the Universe

We live in a cosmos of staggering scale - 93 billion light-years across, 13.8 billion years old, containing ~2 trillion galaxies.

The Big Picture:

Cosmic Scale:
   ⟶ Observable Universe: 93 billion ly diameter (expansion during light travel)
   ⟶ Galaxies: ~2 trillion, each with 100 billion - 1 trillion stars
   ⟶ Stars: ~10²⁴ total (more than grains of sand on Earth)
   ⟶ Our place: Milky Way → Local Group → Virgo Supercluster → Laniakea

Fundamental Forces:
1. Gravity: Shapes cosmos at large scales (Newton → Einstein)
2. Electromagnetism: Light, chemistry, most everyday forces
3. Strong Nuclear: Holds atomic nuclei together
4. Weak Nuclear: Radioactive decay, nuclear fusion in stars

Key Concepts:

1. General Relativity (Einstein, 1915)
   ⟶ Gravity isn't a force - it's curved spacetime
   ⟶ Mass/energy warps space, objects follow geodesics
   ⟶ Predictions: Black holes, gravitational waves, time dilation
   ⟶ Confirmed: GPS needs relativistic corrections!

\`\`\`
E = mc²  (Energy-mass equivalence)
ds² = -c²dt² + dx² + dy² + dz²  (Spacetime interval)
\`\`\`

2. Black Holes 🕳️
   ⟶ Event horizon: Point of no return (Schwarzschild radius)
   ⟶ Singularity: Infinite density at center (physics breaks down)
   ⟶ Types: Stellar (3-100 M☉), Supermassive (10⁶-10¹⁰ M☉ at galaxy centers)
   ⟶ Hawking radiation: Black holes slowly evaporate!
   ⟶ M87*: First black hole image (2019) - 6.5 billion solar masses

3. Dark Matter & Dark Energy 🌑
   ⟶ Dark Matter (27%): Invisible, only interacts gravitationally
  - Evidence: Galaxy rotation curves, gravitational lensing
  - Candidates: WIMPs, axions, primordial black holes?
  - Holds galaxies together (normal matter alone → galaxies fly apart)

   ⟶ Dark Energy (68%): Mysterious force accelerating expansion
  - Discovered 1998 (Nobel Prize 2011)
  - May be cosmological constant (Λ) or dynamic field
  - Universe expanding faster over time!

   ⟶ Normal Matter (5%): Everything we can see - stars, planets, us!

${
	intent.complexity === "expert" || intent.requiresReasoning
		? `Deep Physics:

Quantum Mechanics Meets Gravity:
   ⟶ Problem: QM and GR are incompatible
   ⟶ Planck scale: 10⁻³⁵ m where both matter
   ⟶ Attempts: String theory, loop quantum gravity
   ⟶ Information paradox: What happens to info in black holes?

Cosmic Inflation (Alan Guth, 1980)
   ⟶ First 10⁻³² seconds: Universe expanded by factor of 10²⁶
   ⟶ Why needed: Solves flatness, horizon, monopole problems
   ⟶ Evidence: CMB uniformity, density fluctuations
   ⟶ Mechanism: Inflaton field (hypothetical)

Multiverse Hypotheses:
   ⟶ Many-Worlds: Quantum branching (Everett)
   ⟶ Eternal Inflation: Infinite bubble universes
   ⟶ String Landscape: 10⁵⁰⁰ possible vacuum states
   ⟶ Anthropic principle: We observe universe compatible with our existence

The Fermi Paradox:
   ⟶ Drake equation suggests millions of civilizations
   ⟶ Yet: No contact, no evidence
   ⟶ Great Filter: Before us or ahead?
   ⟶ Maybe: Life is rare, intelligence rarer, technological civilizations don't last`
		: ""
}

Exoplanets & Life:

Planet Hunting (4,000+ confirmed, 2025):
   ⟶ Methods: Transit (dimming), radial velocity (wobble), direct imaging
   ⟶ Habitable zone: Liquid water possible (Goldilocks zone)
   ⟶ Interesting: TRAPPIST-1 (7 Earth-sized planets, 3 in HZ!)
   ⟶ Biosignatures: O₂ + CH₄ together (atmospheric disequilibrium)

Breakthrough Starshot:
   ⟶ Light sail propelled by lasers
   ⟶ Target: Alpha Centauri (4.37 ly) in ~20 years
   ⟶ Tiny probes at 20% speed of light

Observable Phenomena:

Gravitational Waves (LIGO, 2015)
   ⟶ Ripples in spacetime from merging black holes/neutron stars
   ⟶ Einstein predicted 1916, detected 2015 (Nobel 2017)
   ⟶ Opens new window on universe (before: only light!)

Cosmic Microwave Background (CMB)
   ⟶ Afterglow of Big Bang (380,000 years after)
   ⟶ Temperature: 2.725 K (everywhere!)
   ⟶ Tiny fluctuations → seeds of galaxies
   ⟶ Planck satellite mapped with incredible precision

Future Events:
   ⟶ Andromeda-Milky Way collision (4 billion years)
   ⟶ Sun becomes red giant (5 billion years)
   ⟶ Heat death of universe (10¹⁰⁰ years?)

${
	intent.requiresReasoning
		? `\nPhilosophical Implications:

The cosmos reveals our cosmic insignificance yet cosmic connection:
   ⟶ We're made of stardust (literally - carbon, nitrogen, oxygen forged in stellar cores)
   ⟶ Same laws everywhere → Universe is knowable
   ⟶ Vastness humbles, yet our ability to comprehend inspires
   ⟶ Perhaps consciousness is universe understanding itself

Carl Sagan's insight: "The cosmos is within us. We are made of star-stuff. We are a way for the universe to know itself."

The fact that conscious beings evolved to ask these questions - that's perhaps the deepest mystery of all.`
		: ""
}

What cosmic mystery shall we explore? I can dive into quantum mechanics, cosmology, stellar evolution, or speculative physics! 🚀✨`;
		}

		if (/\b(physics|quantum|relativity|particle|energy|force|thermodynamics)\b/i.test(input)) {
			return `⚛️ Physics - The Fundamental Science of Reality

Physics reveals the underlying rules of existence - from subatomic particles to the entire cosmos.

The Two Pillars:

1. Quantum Mechanics (The Very Small)
   ⟶ Governs atoms, electrons, photons
   ⟶ Weird: Superposition, entanglement, uncertainty
   ⟶ Math: Schrödinger equation, wave functions
   ⟶ Interpretation battles: Copenhagen, Many-Worlds, Pilot Wave

2. General Relativity (The Very Large)
   ⟶ Governs gravity, spacetime, cosmos
   ⟶ Insight: Mass curves spacetime
   ⟶ Predictions: Black holes, gravitational waves, time dilation
   ⟶ Problem: Incompatible with quantum mechanics!

Quantum Weirdness Explained:

Wave-Particle Duality
   ⟶ Light and matter are BOTH waves AND particles
   ⟶ Double-slit experiment: Particles interfere like waves
   ⟶ Observation collapses wave function to definite state

Heisenberg Uncertainty Principle
\`\`\`
Δx · Δp ≥ ℏ/2
\`\`\`
   ⟶ Can't know position AND momentum precisely
   ⟶ Not measurement limitation - fundamental reality!
   ⟶ Consequence: Virtual particles pop into existence

Entanglement 🔗
   ⟶ "Spooky action at a distance" (Einstein's dismissal)
   ⟶ Measure one particle → instantly know about partner
   ⟶ Not faster-than-light communication (no information transfer)
   ⟶ Applications: Quantum computing, quantum cryptography

Schrödinger's Cat 🐱
   ⟶ Thought experiment showing absurdity of applying QM to macro
   ⟶ Cat is both alive AND dead until observed
   ⟶ Reality: Decoherence explains classical appearance

${
	intent.complexity === "expert" || intent.requiresReasoning
		? `Unsolved Mysteries:

The Measurement Problem
   ⟶ What counts as "observation"?
   ⟶ Why does measurement collapse wave function?
   ⟶ Interpretations disagree on fundamental nature of reality

Quantum Gravity
   ⟶ Need theory unifying QM + GR
   ⟶ Candidates: String theory (vibrating strings, 11 dimensions)
   ⟶ Loop quantum gravity (spacetime is discrete)
   ⟶ Neither experimentally verified yet

Hierarchy Problem
   ⟶ Why is gravity so weak compared to other forces?
   ⟶ Electromagnetism is 10³⁶ times stronger!
   ⟶ Possible: Extra dimensions, anthropic principle

Dark Matter & Energy
   ⟶ 95% of universe unknown!
   ⟶ Standard Model doesn't account for it
   ⟶ Beyond Standard Model needed`
		: ""
}

Classical Physics (Still Useful!):

Newton's Laws:
\`\`\`
F = ma  (Force = mass × acceleration)
F = G(m₁m₂)/r²  (Universal gravitation)
\`\`\`
   ⟶ Domain: Everyday speeds, sizes
   ⟶ Breaks down: High speeds (relativity), small scales (quantum)

Thermodynamics:
   ⟶ 0th Law: Temperature equilibrium
   ⟶ 1st Law: Energy conserved (E = Q - W)
   ⟶ 2nd Law: Entropy always increases (arrow of time!)
   ⟶ 3rd Law: Can't reach absolute zero

Electromagnetism (Maxwell's Equations):
   ⟶ Unified electricity, magnetism, light
   ⟶ Consequence: Radio, WiFi, microwaves, X-rays all electromagnetic!
   ⟶ Speed of light is constant (led to relativity)

Modern Applications:

Quantum Technologies:
   ⟶ Transistors: Enable all computing (quantum tunneling)
   ⟶ Lasers: Stimulated emission of photons
   ⟶ MRI: Nuclear magnetic resonance
   ⟶ GPS: Relativistic corrections crucial
   ⟶ Quantum computers: Exploiting superposition for massive parallelism

Particle Physics:
   ⟶ Standard Model: Quarks, leptons, bosons
   ⟶ Higgs boson: Gives particles mass (discovered 2012)
   ⟶ LHC: Largest machine ever built (27 km circumference)
   ⟶ Open questions: Matter-antimatter asymmetry, neutrino masses

${
	intent.requiresReasoning
		? `\nProfound Insight:

Physics reveals reality is nothing like our intuition suggests:
   ⟶ Time is relative (depends on speed, gravity)
   ⟶ Matter is mostly empty space (atoms are 99.9999999999999% void)
   ⟶ Particles exist in multiple states simultaneously
   ⟶ Observer affects observed (measurement problem)
   ⟶ Past may not be determinate (quantum mechanics)

The Mystery: Physics is extraordinarily successful at predicting phenomena, yet the fundamental nature of reality remains deeply puzzling. As Feynman said: "I think I can safely say that nobody understands quantum mechanics."

We have mathematical descriptions that work perfectly, yet what's actually happening philosophically unclear. Science answers "how" precisely, "why" remains mysterious.`
		: ""
}

What area of physics intrigues you? I can explore quantum mechanics, relativity, thermodynamics, particle physics, or the foundational questions! ⚡🔬`;
		}

		if (/\b(chemistry|molecule|atom|element|reaction|chemical|periodic table)\b/i.test(input)) {
			return `🧪 Chemistry - The Science of Matter and Transformation

Chemistry bridges physics and biology - it's about how atoms combine, transform, and create everything we experience.

Fundamental Concepts:

Atomic Structure:
   ⟶ Nucleus: Protons (+) + neutrons (neutral)
   ⟶ Electrons: Orbit in orbitals (wave functions!)
   ⟶ Quantum mechanics governs electron behavior
   ⟶ Atomic number (Z) = protons = defines element

Periodic Table (Mendeleev, 1869)
   ⟶ Organizes elements by properties
   ⟶ Periods: Rows (electron shells)
   ⟶ Groups: Columns (similar properties)
   ⟶ Trends: Electronegativity, ionization energy, atomic radius

Chemical Bonds:

1. Covalent (Electron sharing)
   ⟶ Molecules: H₂O, CO₂, organic compounds
   ⟶ Strong (100-400 kJ/mol)
   ⟶ Directional

2. Ionic (Electron transfer)
   ⟶ Salts: NaCl, MgO
   ⟶ Electrostatic attraction
   ⟶ Form crystal lattices

3. Metallic (Electron sea)
   ⟶ Metals: conductivity, malleability
   ⟶ Delocalized electrons

4. Hydrogen bonds (Weak but crucial)
   ⟶ Water's unique properties
   ⟶ DNA double helix
   ⟶ Protein folding

Chemical Reactions:

Types:
   ⟶ Synthesis: A + B → AB
   ⟶ Decomposition: AB → A + B
   ⟶ Combustion: Fuel + O₂ → CO₂ + H₂O + Energy
   ⟶ Redox: Electron transfer (batteries, metabolism)

Thermodynamics:
   ⟶ Exothermic: Releases heat (combustion)
   ⟶ Endothermic: Absorbs heat (photosynthesis)
   ⟶ Gibbs free energy (ΔG) predicts spontaneity
\`\`\`
ΔG = ΔH - TΔS
\`\`\`
   ⟶ Negative ΔG → spontaneous!

Kinetics:
   ⟶ Activation energy: Barrier to reaction
   ⟶ Catalysts: Lower activation energy (enzymes!)
   ⟶ Rate equations: How fast reactions proceed

${
	intent.complexity === "expert" || intent.requiresReasoning
		? `Advanced Chemistry:

Quantum Chemistry:
   ⟶ Molecular orbitals: Linear combinations of atomic orbitals (LCAO)
   ⟶ Bonding/antibonding: Constructive/destructive interference
   ⟶ Computational chemistry: Density Functional Theory (DFT)
   ⟶ Drug design: Computer modeling before synthesis

Organic Chemistry (Carbon-based):
   ⟶ Why carbon?: 4 valence electrons → versatile bonding
   ⟶ Functional groups: -OH (alcohol), -COOH (acid), -NH₂ (amine)
   ⟶ Isomers: Same formula, different structure (properties differ!)
   ⟶ Chirality: Mirror-image molecules (enantiomers)
  - Critical: Thalidomide tragedy - one enantiomer therapeutic, other teratogenic

Biochemistry:
   ⟶ Proteins: Amino acid polymers (enzymes, structure)
   ⟶ Nucleic acids: DNA/RNA (information storage)
   ⟶ Lipids: Membranes, energy storage
   ⟶ Carbohydrates: Energy, structural support

Green Chemistry (Sustainable)
   ⟶ 12 Principles for environmentally friendly synthesis
   ⟶ Atom economy: Minimize waste
   ⟶ Renewable feedstocks
   ⟶ Designing safer chemicals`
		: ""
}

Real-World Applications:

Materials Science:
   ⟶ Polymers: Plastics, rubber (long-chain molecules)
   ⟶ Semiconductors: Silicon (band gap engineering)
   ⟶ Superconductors: Zero resistance (still mostly low temp)
   ⟶ Graphene: Single atom thick, strongest material known

Pharmaceuticals:
   ⟶ Drug discovery: Structure-activity relationships
   ⟶ Synthesis: Multi-step, stereoselective
   ⟶ Aspirin: Simple yet profound (acetylsalicylic acid)
   ⟶ Antibiotics: Beta-lactam ring disrupts bacterial walls

Energy:
   ⟶ Batteries: Lithium-ion (portable electronics revolution)
   ⟶ Fuel cells: H₂ + O₂ → H₂O + electricity
   ⟶ Catalysis: Haber-Bosch process (ammonia for fertilizer feeds billions)
   ⟶ Photovoltaics: Semiconductors convert light → electricity

Everyday Chemistry:
   ⟶ Coffee: Caffeine (C₈H₁₀N₄O₂), chlorogenic acids, Maillard reaction in roasting
   ⟶ Cooking: Caramelization, protein denaturation
   ⟶ Cleaning: Surfactants reduce surface tension
   ⟶ Metabolism: Glycolysis, citric acid cycle, oxidative phosphorylation

${
	intent.requiresReasoning
		? `\nDeep Insight:

Chemistry reveals that complex emerges from simple:
   ⟶ 118 elements combine to create millions of compounds
   ⟶ Properties emerge from structure (diamond vs graphite - both carbon!)
   ⟶ Life itself is sophisticated chemistry (metabolism, replication, evolution)

The Central Dogma (Biology's chemical foundation):
DNA → RNA → Protein → Function

Everything you experience - color, smell, taste, touch - is chemical interactions:
   ⟶ Vision: 11-cis-retinal photoisomerization
   ⟶ Smell: Receptors binding volatile molecules
   ⟶ Drugs: Small molecules modulating protein function
   ⟶ Emotions: Neurotransmitter chemistry (serotonin, dopamine)

Feynman's insight: "Everything is made of atoms... little particles that move around in perpetual motion, attracting each other when they are a little distance apart, but repelling upon being squeezed into one another."

Understanding chemistry means understanding the molecular ballet underlying ALL of existence.`
		: ""
}

What chemistry topic fascinates you? Organic synthesis? Quantum chemistry? Biochemistry? Materials science? 🧬⚗️`;
		}

		if (/\b(biology|life|cell|dna|evolution|organism|gene)\b/i.test(input)) {
			return `🧬 Biology - The Science of Life

Life is chemistry that has learned to make more of itself - a remarkable emergent phenomenon from organic molecules.

Central Dogma of Molecular Biology:

\`\`\`
DNA → RNA → Protein → Function
\`\`\`

DNA (Deoxyribonucleic Acid)
   ⟶ Double helix structure (Watson & Crick, 1953)
   ⟶ Bases: A, T, G, C (complementary pairing)
   ⟶ Stores genetic information
   ⟶ Humans: 3 billion base pairs, ~20,000 genes
   ⟶ 99.9% identical between any two humans!

RNA (Ribonucleic Acid)
   ⟶ Messenger RNA (mRNA): DNA → Protein blueprint
   ⟶ Transfer RNA (tRNA): Brings amino acids
   ⟶ Ribosomal RNA (rRNA): Protein synthesis machinery
   ⟶ Recent: mRNA vaccines (COVID-19) - revolutionary!

Proteins
   ⟶ Polymers of 20 amino acids
   ⟶ Structure: Primary → Secondary → Tertiary → Quaternary
   ⟶ Functions: Enzymes, structure, signaling, transport, defense
   ⟶ Folding problem: Sequence → 3D shape (AlphaFold solved 2020!)

The Cell - Life's Basic Unit:

Prokaryotes (Bacteria, Archaea)
   ⟶ No nucleus
   ⟶ Simpler, smaller
   ⟶ Oldest life form (~3.5 billion years)

Eukaryotes (Plants, Animals, Fungi, Protists)
   ⟶ Nucleus: DNA contained
   ⟶ Organelles:
  - Mitochondria: ATP synthesis (cellular respiration)
  - Chloroplasts (plants): Photosynthesis
  - ER: Protein synthesis, lipid metabolism
  - Golgi: Packaging, modification
  - Lysosomes: Digestion

Cell Membrane
   ⟶ Phospholipid bilayer
   ⟶ Selective permeability
   ⟶ Embedded proteins (channels, receptors, pumps)

Energy & Metabolism:

Photosynthesis (Plants):
\`\`\`
6CO₂ + 6H₂O + Light → C₆H₁₂O₆ + 6O₂
\`\`\`
   ⟶ Converts light → chemical energy
   ⟶ Produces oxygen atmosphere!
   ⟶ Two stages: Light reactions + Calvin cycle

Cellular Respiration (All organisms):
\`\`\`
C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + ATP
\`\`\`
   ⟶ Opposite of photosynthesis
   ⟶ Stages: Glycolysis → Krebs cycle → Electron transport chain
   ⟶ Yield: ~30-32 ATP per glucose

${
	intent.complexity === "expert" || intent.requiresReasoning
		? `Evolution - Life's Unifying Theory:

Natural Selection (Darwin, 1859)
1. Variation: Organisms differ
2. Heredity: Traits passed to offspring
3. Differential reproduction: Some survive/reproduce more
4. Result: Adaptive traits increase in frequency

Evidence:
   ⟶ Fossil record: Transitional forms, dating
   ⟶ Comparative anatomy: Homologous structures (whale flippers, human arms)
   ⟶ Molecular biology: DNA/protein similarities track relationships
   ⟶ Observed evolution: Bacteria antibiotic resistance, peppered moths, Darwin's finches

Mechanisms Beyond Selection:
   ⟶ Mutation: Random changes (genetic variation source)
   ⟶ Genetic drift: Random sampling (especially small populations)
   ⟶ Gene flow: Migration between populations
   ⟶ Sexual selection: Mate choice (peacock's tail)

Speciation:
   ⟶ Allopatric: Geographic isolation
   ⟶ Sympatric: Same location (polyploidy in plants)
   ⟶ Ring species: Gradual variation around barrier

Evolutionary Insights:
   ⟶ Common descent: All life related (universal genetic code!)
   ⟶ Vestigial structures: Whale pelvic bones, human appendix
   ⟶ Convergent evolution: Similar environments → similar solutions (wings: birds, bats, insects)
   ⟶ Coevolution: Reciprocal adaptation (flowers & pollinators)

Modern Biology:

Genetics & Genomics:
   ⟶ Mendelian inheritance: Dominant/recessive alleles
   ⟶ Human Genome Project (2003): All DNA sequenced
   ⟶ CRISPR-Cas9 (2012): Precise gene editing - revolutionary!
   ⟶ Epigenetics: Environment affects gene expression without changing DNA

Biotechnology:
   ⟶ GMOs: Engineered crops (Bt corn, Golden Rice)
   ⟶ Gene therapy: Treating genetic diseases
   ⟶ Synthetic biology: Designing new biological systems
   ⟶ Biofuels: Engineering microbes for energy

Immunology:
   ⟶ Innate: First line (physical barriers, phagocytes)
   ⟶ Adaptive: Learned recognition (B cells, T cells)
   ⟶ Vaccination: Training immune system
   ⟶ Autoimmune: System attacks self
   ⟶ Cancer: Immune escape (immunotherapy breakthrough)

Neuroscience:
   ⟶ Neurons: Electrical signals (action potentials)
   ⟶ Synapses: Chemical communication (neurotransmitters)
   ⟶ Brain regions: Specialized functions yet plastic
   ⟶ Consciousness: Emergent from neural activity (hard problem!)

Ecology:
   ⟶ Trophic levels: Producers → Consumers → Decomposers
   ⟶ Energy flow: 10% transferred between levels
   ⟶ Biogeochemical cycles: Carbon, nitrogen, water
   ⟶ Biodiversity: More species → ecosystem stability
   ⟶ Keystone species: Disproportionate importance (wolves, sea otters)

Conservation Challenges:
   ⟶ Climate change, habitat loss, pollution
   ⟶ 6th mass extinction (Anthropocene)
   ⟶ Solutions: Protected areas, sustainable practices, restoration`
		: ""
}

${
	intent.requiresReasoning
		? `\nProfound Implications:

What is Life?
Surprisingly hard to define! Characteristics:
   ⟶ Organization (cells)
   ⟶ Metabolism (energy processing)
   ⟶ Growth & development
   ⟶ Reproduction
   ⟶ Response to environment
   ⟶ Homeostasis (maintaining conditions)
   ⟶ Evolution

But: Viruses don't metabolize (living?), mules can't reproduce (not living?), fire grows and responds (but not alive!)

Life's Deep Questions:
   ⟶ Origin: How did non-living chemistry become living? (Abiogenesis)
  - RNA world hypothesis: RNA both information & catalyst
  - Hydrothermal vents: Energy gradients
   ⟶ Uniqueness: Are we alone? (Astrobiology)
   ⟶ Consciousness: How do neurons → subjective experience?
   ⟶ Purpose: Evolutionary perspective: survive, reproduce. Philosophical: you decide!

The Miracle: From simple rules (physics, chemistry) emerges complexity beyond imagination - cells, organs, organisms, ecosystems, consciousness. Life is matter that has learned to contemplate itself.

Richard Dawkins: "We are survival machines – robot vehicles blindly programmed to preserve the selfish molecules known as genes." Yet we transcend this through culture, reason, and compassion.`
		: ""
}

What aspect of life sciences intrigues you? Molecular biology? Evolution? Neuroscience? Ecology? 🌱🔬`;
		}

		return `🔬 Science - Humanity's Greatest Tool for Understanding Reality

Science is the systematic study of the natural world through observation, experimentation, and reasoning.

The Scientific Method:

1. Observe: Notice phenomena
2. Question: What, why, how?
3. Hypothesize: Testable prediction
4. Experiment: Controlled test
5. Analyze: Interpret data
6. Conclude: Support or refute hypothesis
7. Replicate: Others must verify

Major Branches:

Physical Sciences:
   ⟶ Physics: Matter, energy, forces
   ⟶ Chemistry: Composition, reactions
   ⟶ Astronomy: Cosmos, celestial bodies
   ⟶ Geology: Earth structure, processes

Life Sciences:
   ⟶ Biology: Living organisms
   ⟶ Ecology: Interactions, ecosystems
   ⟶ Genetics: Heredity, variation
   ⟶ Neuroscience: Nervous systems, cognition

Formal Sciences:
   ⟶ Mathematics: Abstract structures
   ⟶ Logic: Valid reasoning
   ⟶ Computer Science: Computation, information

Why Science Works:

✅ Falsifiable: Can be proven wrong
✅ Empirical: Based on evidence
✅ Replicable: Others can verify
✅ Peer Review: Community scrutiny
✅ Self-Correcting: Updates with new evidence

${
	intent.requiresReasoning
		? `\nProfound Insights:

Science reveals:
   ⟶ Cosmos is knowable: Same laws everywhere
   ⟶ Emerged from simple: Complexity from basic rules
   ⟶ Connected: Everything influences everything
   ⟶ Evolving: Universe, life, knowledge all change

Limits of Science:
   ⟶ Can't address "should" (ethics, values)
   ⟶ Can't prove negatives
   ⟶ Inductive reasoning not certain
   ⟶ Some questions beyond scope (meaning, purpose)

Yet: Science is our most reliable method for understanding how nature works. It gave us medicine, technology, space exploration, and deep insights into our place in the universe.

Carl Sagan: "Science is a way of thinking much more than it is a body of knowledge."

The wonder is that the universe is comprehensible at all - that mathematical equations describe reality, that experiments reveal truth, that human minds can grasp cosmic principles.`
		: ""
}

What scientific domain fascinates you? I can explore physics, chemistry, biology, astronomy, or the philosophy of science! 🚀🧬⚛️`;
	}

	private generateCoffeeResponse(input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const lower = input.toLowerCase();

		if (lower.includes("brew") || lower.includes("make")) {
			return "Brewing great coffee is both an art and a science! The key factors are: quality beans, proper grind size, water temperature (90-96°C), and brewing time. For espresso, you need fine grounds and high pressure. For pour-over, medium grounds and patience. For French press, coarse grounds and 4 minutes of steeping. With Nespresso capsules, the brewing is perfected for you - just choose the right capsule for your taste! What brewing method are you interested in?";
		}

		if (lower.includes("caffeine")) {
			return "Caffeine is coffee's most famous compound! It's a natural stimulant that blocks adenosine receptors in your brain, making you feel more alert and awake. A typical espresso shot has 60-80mg of caffeine, while a lungo has more due to longer extraction. Caffeine affects everyone differently - factors include tolerance, body weight, and genetics. It peaks in your bloodstream after 30-60 minutes and has a half-life of 3-5 hours. How do you like your caffeine?";
		}

		if (lower.includes("roast")) {
			return "Coffee roasting transforms green beans into the aromatic brown beans we love! Light roasts preserve more of the bean's original flavors - bright, fruity, acidic. Medium roasts balance acidity and body with sweet, chocolatey notes. Dark roasts develop bold, smoky flavors with less acidity. The roasting process involves careful temperature control and timing - it's where much of coffee's flavor is created. Each roast level offers a unique experience. What's your preferred roast?";
		}

		return "Coffee is an incredible beverage with rich history and complex chemistry! From the coffee cherry grown at high altitudes to the carefully roasted and brewed cup, every step affects the final flavor. Whether you're exploring single-origin beans, perfecting your espresso technique, or discovering new Nespresso capsules, there's always more to learn about coffee. What would you like to know?";
	}

	private generateHealthResponse(input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const lower = input.toLowerCase();

		if (lower.includes("exercise") || lower.includes("fitness")) {
			return "Physical fitness is crucial for overall health! Regular exercise strengthens your cardiovascular system, builds muscle, improves flexibility, and boosts mental health. The WHO recommends at least 150 minutes of moderate aerobic activity per week, plus strength training twice weekly. But any movement is better than none - even a 10-minute walk has benefits. The key is consistency and finding activities you enjoy. What's your approach to fitness?";
		}

		if (lower.includes("nutrition") || lower.includes("diet")) {
			return "Nutrition is the foundation of health! A balanced diet includes diverse whole foods: fruits, vegetables, whole grains, lean proteins, and healthy fats. Each nutrient plays specific roles - proteins build tissue, carbs provide energy, fats support hormones and cell membranes, vitamins and minerals regulate countless processes. The Mediterranean diet, rich in plants, fish, and olive oil, is one of the most studied for health benefits. Remember, small sustainable changes work better than extreme diets. What nutritional aspect interests you?";
		}

		return "Health is wealth, as they say! It encompasses physical fitness, mental wellbeing, nutrition, sleep, and stress management. Modern research shows these factors are deeply interconnected - good sleep improves workout recovery, exercise enhances mental health, proper nutrition supports everything. The key is balance and consistency rather than perfection. What health topic would you like to explore?";
	}

	private generateGeneralResponse(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const lower = input.toLowerCase();

		// Enhanced "what is" questions with comprehensive explanations
		if (intent.questionType === "what" || lower.includes("what is") || lower.includes("what's")) {
			return `🎯 Excellent Question!

Let me provide a comprehensive answer that covers multiple dimensions:

📖 Understanding the Concept

I'll analyze this from multiple perspectives to give you a complete picture.${
				intent.requiresReasoning ? " Let me reason through this systematically." : ""
			}

💡 Core Definition

${this.extractConceptDefinition(input, intent)}

🔑 Key Aspects

${this.identifyKeyAspects(input, intent)}

🌟 Practical Significance

${
	intent.complexity === "complex" || intent.complexity === "expert"
		? "Understanding this concept has far-reaching implications across multiple domains. It's not just theoretical—it shapes how we approach related problems and opens new possibilities."
		: "This matters because it affects how we understand and interact with the world around us. It's a foundational concept that connects to everyday experiences."
}

🔗 Related Concepts

${this.suggestRelatedConcepts(intent)}

---

💬 Want to dive deeper? I can provide:
   ⟶ More detailed explanations with examples
   ⟶ Real-world applications and case studies
   ⟶ Connections to related topics
   ⟶ Historical context and evolution

Which aspect intrigues you most?`;
		}

		// Enhanced "how to" questions with step-by-step reasoning
		if (intent.questionType === "how" || /how to|how do|how can/.test(lower)) {
			return `🎓 Great Practical Question!

Let me guide you through this systematically:

🎯 Objective Analysis

${this.clarifyGoal(input)}

📚 Prerequisites & Foundation

Before starting, you should understand/have:

${this.identifyPrerequisites(intent)}

📝 Step-by-Step Approach

${intent.requiresMultiStep ? this.generateStepByStep(input, intent) : "Let me outline the process clearly with actionable steps."}

⚠️ Common Pitfalls to Avoid

   ⟶ ❌ Rushing without understanding fundamentals
   ⟶ ❌ ${intent.complexity === "expert" ? "Overlooking edge cases and error handling" : "Skipping practice and application"}
   ⟶ ❌ Not seeking feedback or iterating on your approach

✨ Best Practices

${this.provideBestPractices(intent)}

🚀 Resources for Learning

${this.suggestLearningPath(intent)}

${
	intent.requiresReasoning
		? "\n---\n\n🧠 Pro Tip: The key is understanding *why* each step matters, not just memorizing procedures. This builds true competence that transfers to new situations."
		: ""
}

💬 Need more details? I can elaborate on any particular step or explore specific challenges you might face!`;
		}

		// Enhanced "why" questions with causal reasoning
		if (intent.questionType === "why" || /why is|why do|why does/.test(lower)) {
			return `🤔 Excellent "Why" Question!

This requires examining causes, mechanisms, and deeper understanding:

🎯 Surface-Level Answer

${this.provideSurfaceAnswer(input, intent)}

🔬 Deeper Causal Analysis

Let me reason through the underlying causes:

#1️⃣ Proximate Causes (immediate reasons)

${this.identifyProximateCauses(input, intent)}

#2️⃣ Ultimate Causes (fundamental reasons)

${this.identifyUltimateCauses(input, intent)}

#3️⃣ Historical Context

${this.provideHistoricalContext(input, intent)}

#4️⃣ Interconnected Factors

${
	intent.complexity === "complex" || intent.complexity === "expert"
		? "This isn't monocausal - multiple factors interact in complex ways:"
		: "Several factors contribute to the full picture:"
}

${this.identifyInteractingFactors(intent)}

🌟 Implications & Consequences

Understanding *why* empowers us to:
   ⟶ Predict similar outcomes in different contexts
   ⟶ Control and influence related phenomena
   ⟶ Innovate by applying principles creatively${
		intent.requiresReasoning ? "\n   ⟶ Recognize patterns applicable to analogous situations" : ""
   }

🔄 Alternative Perspectives

${this.provideAlternativePerspectives(intent)}

---

💭 This is a rich question with multiple layers. Which aspect would you like to explore further? I can dive deeper into any of these dimensions!`;
		}

		// Enhanced capability questions
		if (/can you|are you able|do you/.test(lower)) {
			return `🤖 My Capabilities as Kafelot

💪 What I Can Do

✅ Deep Reasoning
   → Multi-step logical analysis, causal reasoning, hypothetical scenarios

✅ Comprehensive Knowledge
   → Technology, science, mathematics, philosophy, history, arts, psychology, economics

✅ Sophisticated Conversations
   → Context-aware, nuanced discussions on complex topics

✅ Problem Solving
   → Break down complex problems, identify solutions, explain trade-offs

✅ Educational Support
   → Teach concepts, provide examples, clarify misunderstandings

✅ Coffee Expertise ☕
   → Specialized knowledge about Nespresso, brewing, coffee science

---

🎯 My Design Philosophy

   ⟶ Well-reasoned answers, not just quick responses
   ⟶ Multiple perspectives and nuanced considerations
   ⟶ Honest about uncertainty when appropriate
   ⟶ Critical thinking encouraged in every interaction

---

⚠️ Current Limitations

❌ No real-time internet access (knowledge cutoff: 2025 training)
❌ Can't browse websites or access current news
❌ Can't perform external actions or run code
❌ Can't access personal data unless you share it in conversation

${
	intent.requiresReasoning
		? "\n---\n\n💡 Think of me as a knowledgeable companion who can reason through problems with you, rather than just answering factual questions. I'm designed for thoughtful, in-depth conversations that help you truly understand topics.\n"
		: ""
}

🚀 What would you like help with today?`;
		}

		// Enhanced "who are you" questions
		if (/who are you|what are you|about you/.test(lower)) {
			return `👋 I'm Kafelot

Your Advanced AI Assistant for 2025! 🤖☕

---

✨ What Makes Me Different

1️⃣ Comprehensive Knowledge

I'm trained across diverse domains: STEM fields, humanities, arts, practical skills. Not just surface-level facts—I understand interconnections and can reason through complexity.

2️⃣ Sophisticated Reasoning

   ⟶ 🧩 Multi-step logical analysis
   ⟶ 🔍 Causal reasoning (understanding *why*, not just *what*)
   ⟶ 🎭 Hypothetical scenarios and comparisons
   ⟶ ⚖️ Trade-off analysis and decision support

3️⃣ Context Awareness

I remember our conversation, understand nuance, and adapt my responses to:
   ⟶ 📊 Complexity level you need
   ⟶ 🎯 Your interests and goals
   ⟶ 📖 The depth of explanation required

4️⃣ Coffee Specialization ☕

Beyond general AI capabilities, I'm an expert in coffee—from bean to cup, brewing science to Nespresso recommendations.

---

🎯 My Approach

| Value | What It Means |
|-----------|-------------------|
| Thoughtful | Over quick |
| Comprehensive | Over superficial |
| Reasoning | Over memorization |
| Honest | About uncertainty |

${
	intent.complexity === "complex"
		? "\n---\n\n💡 I'm designed for deep, meaningful conversations that help you actually understand topics, not just get quick answers. Think of me as a knowledgeable companion on your intellectual journey.\n"
		: ""
}

---

💭 My Philosophy

> *"Give a person a fact, help them for a moment.*  
> *Teach them to reason, help them for a lifetime."*

---

🚀 What intellectual adventure shall we embark on today?`;
		}

		// Expert-level complex queries
		if (intent.complexity === "expert") {
			return `🎓 Sophisticated Query Detected

This deserves a comprehensive, nuanced response:

---

🔬 Multi-Dimensional Analysis

#1️⃣ Conceptual Framework

${this.establishFramework(intent)}

#2️⃣ Theoretical Underpinnings

${this.exploreTheory(intent)}

#3️⃣ Practical Implications

${this.analyzeImplications(intent)}

#4️⃣ Critical Evaluation

Examining assumptions, limitations, and alternatives:

${this.provideCritique(intent)}

#5️⃣ Synthesis

${this.synthesizeExpertAnswer(intent)}

---

🌐 Interdisciplinary Connections

${this.connectDisciplines(intent)}

${
	intent.requiresReasoning
		? "\n---\n\n🧠 Deep Insight: The key is not just understanding individual pieces, but how they interconnect to form a coherent whole. This reveals emergent properties and patterns invisible from any single perspective.\n"
		: ""
}

💬 Which dimension would you like to explore in greater depth? I can provide:
   ⟶ Detailed mathematical or logical formulations
   ⟶ Historical development and key thinkers
   ⟶ Contemporary debates and unresolved questions
   ⟶ Practical applications and case studies`;
		}

		// Complex statements requiring acknowledgment and follow-up
		if (intent.complexity === "complex") {
			return `💭 Thoughtful Engagement

I appreciate the depth and nuance of what you're expressing. Let me engage with this carefully:

---

🎯 Understanding Your Point

${this.acknowledgeComplexity(input, intent)}

---

🔑 Key Considerations

${this.identifyKeyConsiderations(intent)}

---

👁️ Multiple Perspectives

This topic deserves examination from various angles:

${this.exploreMultiplePerspectives(intent)}

---

🌟 Implications & Extensions

${
	intent.requiresReasoning
		? "Following this line of reasoning leads to interesting implications:"
		: "This connects to broader questions:"
}

${this.exploreImplications(intent)}

---

🎨 Synthesis

${this.provideSynthesis(intent)}

---

💡 This is the kind of rich, complex topic I enjoy discussing!

Would you like to:
   ⟶ 🔍 Dive deeper into any particular aspect
   ⟶ 🔄 Explore related questions or counterarguments
   ⟶ 🎯 Apply these ideas to specific scenarios
   ⟶ 📚 Learn about key thinkers or historical context`;
		}

		// Thoughtful fallback for any other input
		return `👋 I'm Listening Carefully

Let me provide a thoughtful response:

---

🎯 What I Understand

You're ${intent.sentiment === "curious" ? "curious about" : "interested in exploring"} ${intent.topics.join(", ")}.

---

🤖 How I Can Help

I'm Kafelot, equipped with:

| Capability | Description |
|----------------|-----------------|
| 🧠 Broad Knowledge | Technology, science, philosophy, arts, history, and more |
| 🔍 Deep Reasoning | Not just facts, but understanding *why* and *how* |
| 🎯 Contextual Understanding | Adapting to your needs and interests |
| ☕ Coffee Expertise | My specialty domain! |

---

🚀 Let's Explore Together

Whether you want:

✨ Explanations of complex concepts  
📝 Step-by-step guidance on practical tasks  
💭 Philosophical discussions on deep questions  
🔧 Practical problem-solving for real challenges  
💬 Or just a thoughtful conversation about topics that interest you

${
	intent.requiresReasoning
		? "\n💡 I'm designed for meaningful dialogues that help you truly understand topics, not just get quick answers. Let's think through this together!\n"
		: "\n💡 I'm here to help you learn, understand, and explore ideas in depth.\n"
}

---

💬 Let's Get Specific

What specific aspect interests you most?

The more details you share, the more tailored and insightful my response can be!

*Examples of great questions:*
   ⟶ "Explain [concept] like I'm a beginner"
   ⟶ "How does [X] compare to [Y]?"
   ⟶ "Why does [phenomenon] happen?"
   ⟶ "What are the practical applications of [topic]?"`;
	}

	// Helper methods for comprehensive general responses
	private extractConceptDefinition(input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return `Based on your question, the concept involves ${intent.topics.join(" and ")}. 

At its core, it represents an important idea with both theoretical foundations and practical dimensions. Understanding this concept opens doors to deeper insights in related areas.`;
	}

	private identifyKeyAspects(_input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const aspects = ["   ⟶ 🏗️ Fundamental principles and foundations", "   ⟶ 🔧 Practical applications and real-world use"];
		if (intent.complexity === "expert" || intent.complexity === "complex") {
			aspects.push("   ⟶ 🎯 Advanced considerations and nuances", "   ⟶ 🚀 Current state and future directions");
		}
		return aspects.join("\n");
	}

	private suggestRelatedConcepts(intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return `Within ${intent.topics[0]}, related concepts include interconnected ideas that form a comprehensive understanding of the domain. These connections reveal how different concepts support and illuminate each other.`;
	}

	private clarifyGoal(input: string): string {
		const goal = input.slice(0, 80);
		return `Your goal is to ${goal}${input.length > 80 ? "..." : ""}

This requires understanding both:
   ⟶ *What* to do (the practical steps)
   ⟶ *Why* it works (the underlying principles)`;
	}

	private identifyPrerequisites(intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const prereqs = ["   ⟶ 📚 Basic understanding of foundational concepts"];
		if (intent.complexity === "complex" || intent.complexity === "expert") {
			prereqs.push("   ⟶ 🎓 Familiarity with intermediate principles", "   ⟶ 🧠 Ability to think critically and analyze");
		}
		return prereqs.join("\n");
	}

	private generateStepByStep(_input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return `📍 Phase 1: Foundation
→ Understand the basics and build solid groundwork

🔨 Phase 2: Application
→ Practice with examples and real scenarios

🎯 Phase 3: Mastery
→ Develop deep competence through repetition

💡 Phase 4: Innovation
→ Apply creatively to new situations`;
	}

	private provideBestPractices(intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		const practices = [
			"   ⟶ 🎯 Start with fundamentals, build progressively",
			"   ⟶ 🔄 Practice regularly with varied examples",
		];
		if (intent.complexity === "expert") {
			practices.push("   ⟶ 📊 Study both successes and failures", "   ⟶ 🔁 Seek feedback and iterate continuously");
		}
		return practices.join("\n");
	}

	private suggestLearningPath(_intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return `📚 Foundational knowledge → 🔧 Practical application → 🧠 Deep understanding → 🎓 Expert mastery`;
	}

	private provideSurfaceAnswer(_input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "The immediate answer addresses the direct question, but there's much more beneath the surface worth exploring.";
	}

	private identifyProximateCauses(_input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "The immediate, observable factors that directly lead to the outcome. These are the visible triggers and conditions.";
	}

	private identifyUltimateCauses(_input: string, intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return intent.complexity === "expert"
			? "The deep, foundational principles and historical forces that created the conditions for this phenomenon. These are the root causes that explain the existence and structure of the proximate causes."
			: "The underlying reasons that explain why things are the way they are, beyond just the immediate triggers.";
	}

	private provideHistoricalContext(_input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "This didn't arise in a vacuum—historical developments and accumulated knowledge shaped current understanding. Context reveals how we arrived at this point.";
	}

	private identifyInteractingFactors(intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return (
			intent.topics.map((topic) => `   ⟶ 🔗 Factors from ${topic}`).join("\n") +
			"\n   ⟶ ✨ Emergent properties from their complex interaction"
		);
	}

	private provideAlternativePerspectives(intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return intent.complexity === "expert"
			? "Different theoretical frameworks offer complementary explanations, each highlighting different aspects of the phenomenon. No single perspective captures the full picture."
			: "Different viewpoints exist, each with valid insights from their perspective. Comparing them enriches understanding.";
	}

	private establishFramework(_intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "Establishing a rigorous conceptual framework allows us to analyze this systematically and comprehensively.";
	}

	private exploreTheory(_intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "The theoretical foundations draw from established principles while incorporating recent developments and insights.";
	}

	private analyzeImplications(_intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "Practical implications span immediate applications, long-term consequences, and potential future developments.";
	}

	private provideCritique(_intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "Critical analysis reveals both strengths and limitations, helping us understand boundaries of applicability.";
	}

	private synthesizeExpertAnswer(_intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "Synthesizing these elements: the answer emerges not from any single factor but from understanding their complex interrelationships.";
	}

	private connectDisciplines(intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return `This topic connects ${intent.topics.join(
			", "
		)}, demonstrating how knowledge domains interconnect and inform each other.`;
	}

	private acknowledgeComplexity(_input: string, _intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "Your statement touches on multiple important dimensions that deserve careful consideration.";
	}

	private identifyKeyConsiderations(_intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "   ⟶ Historical and contextual factors\n   ⟶ Logical and empirical evidence\n   ⟶ Practical and theoretical implications\n   ⟶ Trade-offs and competing priorities";
	}

	private exploreMultiplePerspectives(_intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "Different stakeholders, theoretical frameworks, and cultural contexts offer varied but valuable insights.";
	}

	private exploreImplications(_intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "   ⟶ Short-term practical consequences\n   ⟶ Long-term strategic implications\n   ⟶ Unintended or emergent effects\n   ⟶ Opportunities for innovation";
	}

	private provideSynthesis(_intent: ReturnType<KafelotAI["analyzeIntent"]>): string {
		return "Bringing it all together: the richness comes from appreciating both individual elements and their dynamic interactions.";
	}
}

// ============================================================================
// SUBSCRIPTION-BASED MODEL ACCESS CONTROL
// ============================================================================
type UserSubscription = "none" | "basic" | "pro" | "max" | "ultimate";

function getModelAccessLevel(subscription: UserSubscription): ModelTier {
	switch (subscription) {
		case "ultimate":
			return "ultra"; // Ultimate subscription gets Ultra model
		case "max":
			return "pro"; // Max subscription gets Pro model
		case "pro":
		case "basic":
		case "none":
		default:
			return "flash"; // Pro/Basic/No subscription gets Flash model
	}
}

function canAccessModel(subscription: UserSubscription, requestedModel: ModelTier): boolean {
	const maxAllowedModel = getModelAccessLevel(subscription);

	// Model hierarchy: flash < pro < ultra
	const modelHierarchy: Record<ModelTier, number> = {
		flash: 1,
		pro: 2,
		ultra: 3,
	};

	return modelHierarchy[requestedModel] <= modelHierarchy[maxAllowedModel];
}

// API endpoint handler - supports multi-model selection with subscription control
export async function POST(request: NextRequest) {
	try {
		const { messages, mode, model, subscription } = (await request.json()) as {
			messages: Array<{ role: string; content: string }>;
			mode: "coffee" | "general";
			model?: "flash" | "pro" | "ultra";
			subscription?: UserSubscription;
		};

		const userMessage = messages[messages.length - 1]?.content || "";
		const conversationContext = messages.slice(-5).map((m) => m.content);

		let response: string;
		let suggestedProducts: CoffeeProduct[] = [];
		let modelInfo: ModelConfig | undefined;
		let accessDenied = false;

		if (mode === "general") {
			// Determine user's subscription level (default to "none" if not provided)
			const userSubscription: UserSubscription = subscription || "none";

			// Check if requested model is valid, default to "pro"
			const requestedModel: ModelTier = model || "pro";

			// Verify user has access to the requested model
			if (!canAccessModel(userSubscription, requestedModel)) {
				// User doesn't have access, use their maximum allowed model instead
				const allowedModel = getModelAccessLevel(userSubscription);
				const ai = new KafelotAI(allowedModel);
				modelInfo = ai.getModelInfo();

				// Inform user about access restriction
				response = `🔒 Access Restricted

You requested ${MODEL_CONFIGS[requestedModel].name}, but your current subscription (${
					userSubscription === "none" ? "Free" : userSubscription.charAt(0).toUpperCase() + userSubscription.slice(1)
				}) doesn't include access to this model.

📊 Your Active Model: ${modelInfo.name} (${modelInfo.parameters} parameters)

🚀 Upgrade Your Experience:

${
	userSubscription === "none"
		? "   ⟶ Basic Plan (46.05 RON): Access to Kafelot Flash (100M)\n      • Quick responses\n      • 15-conversation memory\n      • 10 capsules/month\n      • Perfect for everyday queries\n\n"
		: ""
}${
					userSubscription === "none" || userSubscription === "basic"
						? "   ⟶ Pro Plan (92.15 RON): Access to Kafelot Flash (100M)\n      • Quick responses\n      • 15-conversation memory\n      • 30 capsules/month\n      • More coffee, same great AI\n\n"
						: ""
				}${
					userSubscription !== "max" && userSubscription !== "ultimate"
						? "   ⟶ Max Plan (138.15 RON): Access to Kafelot Pro (200M)\n      • Advanced reasoning\n      • 30-conversation memory\n      • 60 capsules/month\n      • Multi-step analysis\n      • Technical depth\n\n"
						: ""
				}${
					userSubscription !== "ultimate"
						? "   ⟶ Ultimate Plan (230.38 RON): Access to Kafelot Ultra (400M)\n      • Maximum intelligence\n      • 50-conversation memory\n      • 120 capsules/month\n      • Expert-level analysis\n      • Interdisciplinary synthesis\n      • Deep research capabilities\n\n"
						: ""
				}
Visit our Subscription page to upgrade and unlock the full power of Kafelot AI!

In the meantime, I'm here to help with ${modelInfo.name}. What would you like to know?`;
				accessDenied = true;
			} else {
				// User has access, use requested model
				const ai = new KafelotAI(requestedModel);
				response = ai.generateResponse(userMessage, conversationContext);
				modelInfo = ai.getModelInfo();
			}
		} else {
			// Coffee Expert mode - focused on coffee recommendations
			const result = generateCoffeeResponse(userMessage);
			response = result.response;
			suggestedProducts = result.products;
		}

		return NextResponse.json({
			response,
			products: suggestedProducts,
			mode,
			modelInfo,
			accessDenied,
		});
	} catch (error) {
		console.error("Chat API error:", error);
		return NextResponse.json({ error: "Failed to process chat request" }, { status: 500 });
	}
}

// Coffee-specific response generator
function generateCoffeeResponse(input: string): { response: string; products: CoffeeProduct[] } {
	const lower = input.toLowerCase();
	const allProducts = coffeeCollections.flatMap((collection) => collection.groups.flatMap((group) => group.products));

	let response = "";
	let suggestedProducts: CoffeeProduct[] = [];

	// Pattern definitions for coffee queries
	const patterns = {
		strong: /(strong|intense|powerful|bold|kick)/i,
		sweet: /(sweet|chocolate|caramel|honey|dessert)/i,
		fruity: /(fruity|citrus|floral|berry|bright)/i,
		morning: /(morning|breakfast|wake up|start day)/i,
		evening: /(evening|night|after dinner|late)/i,
		mild: /(mild|light|gentle|smooth|easy)/i,
		comparison: /(difference|compare|versus|vs|between original and vertuo)/i,
		recommendation: /(recommend|suggest|best|top|popular|favorite)/i,
	};

	// Intensity-based queries
	if (patterns.strong.test(input)) {
		const strong = allProducts.filter((p) => (p.intensity ?? 0) >= 10).slice(0, 4);
		response =
			"⚡ High-Intensity Powerhouses - Kafelot recommends:\n\nFor those who love bold, robust coffee:\n   ⟶ Kazaar (Intensity 12): Maximum intensity, spicy notes\n   ⟶ Ristretto (Intensity 10): Pure Arabica, powerful\n   ⟶ Arpeggio (Intensity 9): Intense cocoa notes\n\nThese will definitely wake you up!";
		suggestedProducts = strong;
		return { response, products: suggestedProducts };
	}

	if (patterns.mild.test(input)) {
		const mild = allProducts.filter((p) => (p.intensity ?? 0) <= 6).slice(0, 4);
		response =
			"🌸 Smooth & Gentle Options - Kafelot suggests:\n\nFor a refined, balanced experience:\n   ⟶ Volluto (Intensity 4): Sweet and light\n   ⟶ Cosi (Intensity 4): Delicate, fruity\n   ⟶ Capriccio (Intensity 5): Gentle cereal notes\n\nPerfect for all-day enjoyment!";
		suggestedProducts = mild;
		return { response, products: suggestedProducts };
	}

	// Flavor profile queries
	if (patterns.sweet.test(input)) {
		const sweet = allProducts.filter((p) =>
			p.notes?.some((n: string) =>
				["chocolate", "caramel", "sweet", "honey", "biscuit"].some((kw) => n.toLowerCase().includes(kw))
			)
		);
		response =
			"🍫 Sweet & Indulgent Selections - Kafelot's picks:\n\nFor those with a sweet tooth:\n   ⟶ Chocolate notes: Livanto, Arpeggio, Ciocattino\n   ⟶ Caramel sweetness: Caramelizio, Colombian\n   ⟶ Honey tones: Ethiopia, Costa Rica\n\nPerfect with milk or as a dessert coffee!";
		suggestedProducts = sweet.slice(0, 4);
		return { response, products: suggestedProducts };
	}

	if (patterns.fruity.test(input)) {
		const fruity = allProducts.filter((p) =>
			p.notes?.some((n: string) =>
				["citrus", "floral", "fruity", "berry", "wine", "tangy"].some((kw) => n.toLowerCase().includes(kw))
			)
		);
		response =
			"🍊 Bright & Fruity Recommendations - Kafelot explores:\n\nFor complex, nuanced flavors:\n   ⟶ Citrus notes: Ethiopia, Kenya\n   ⟶ Floral aromas: Colombia, Ethiopia\n   ⟶ Berry-like: Kenya, Burundi\n\nThese single-origin coffees showcase terroir beautifully!";
		suggestedProducts = fruity.slice(0, 4);
		return { response, products: suggestedProducts };
	}

	// Time-based recommendations
	if (patterns.morning.test(input)) {
		const morning = allProducts.filter((p) => (p.intensity ?? 0) >= 6 && (p.intensity ?? 0) <= 9).slice(0, 4);
		response =
			"🌅 Perfect Morning Blends - Kafelot's morning routine:\n\nTo start your day right:\n   ⟶ Livanto (Intensity 6): Balanced, caramelly\n   ⟶ Melozio (Intensity 6): Smooth, cereal notes\n   ⟶ Colombia (Intensity 6): Bright, winey\n\nBalanced intensity to energize without overwhelming!";
		suggestedProducts = morning;
		return { response, products: suggestedProducts };
	}

	if (patterns.evening.test(input)) {
		const evening = allProducts.filter((p) => (p.intensity ?? 0) <= 5).slice(0, 4);
		response =
			"🌙 Evening-Friendly Options - Kafelot's night picks:\n\nLower intensity for late-day enjoyment:\n   ⟶ Volluto (Intensity 4): Sweet, light\n   ⟶ Cosi (Intensity 4): Delicate, fruity\n   ⟶ Half Caffeinato (Intensity 5): 50% less caffeine\n\nWon't keep you up all night!";
		suggestedProducts = evening;
		return { response, products: suggestedProducts };
	}

	// System comparison
	if (patterns.comparison.test(input)) {
		response =
			"📊 Original vs Vertuo - Kafelot explains:\n\nOriginal Line:\n   ⟶ 40ml espresso shots\n   ⟶ Intense, concentrated\n   ⟶ Traditional Italian style\n   ⟶ Perfect for milk drinks\n\nVertuo Line:\n   ⟶ 40ml-414ml sizes (5 types)\n   ⟶ Centrifusion brewing\n   ⟶ Coffee-shop style mugs\n   ⟶ Barcode technology\n\nWhich style suits your taste?";
		return { response, products: [] };
	}

	// General recommendations
	if (patterns.recommendation.test(input)) {
		response =
			"⭐ Kafelot's Top Picks:\n\nCrowd Favorites:\n   ⟶ Livanto: Balanced everyday blend\n   ⟶ Arpeggio: Intense character\n   ⟶ Volluto: Sweet & light\n\nUnique Experiences:\n   ⟶ Master Origins Ethiopia: Floral notes\n   ⟶ Kazaar: Maximum intensity\n   ⟶ Paris Black: Limited edition luxury\n\nWhat flavor profile interests you?";
		const topPicks = allProducts.filter((p) =>
			["livanto", "arpeggio", "volluto", "ethiopia", "kazaar", "paris"].some((name) => p.name?.toLowerCase().includes(name))
		);
		suggestedProducts = topPicks.slice(0, 5);
		return { response, products: suggestedProducts };
	}

	// Fallback: smart fuzzy search
	const tokens = lower.split(/\s+/).filter((w) => w.length > 3);
	const matches = allProducts.filter((p) =>
		tokens.some(
			(t) =>
				p.name?.toLowerCase().includes(t) ||
				p.description?.toLowerCase().includes(t) ||
				p.notes?.some((n: string) => n.toLowerCase().includes(t))
		)
	);

	if (matches.length > 0) {
		response = "Based on your query, Kafelot found these capsules:";
		suggestedProducts = matches.slice(0, 4);
	} else {
		response =
			"I'm Kafelot, your coffee pilot explorer! 🚀☕\n\nI can help you discover the perfect capsule. Ask me about:\n\n   ⟶ Intensity: mild, medium, strong\n   ⟶ Flavors: chocolate, fruity, nutty\n   ⟶ Time: morning, evening\n   ⟶ System: Original vs Vertuo\n   ⟶ Origins: Ethiopia, Colombia, etc.\n\nOr switch to General AI mode for broader conversations! What interests you?";
	}

	return { response, products: suggestedProducts };
}
