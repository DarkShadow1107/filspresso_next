"use client";

import { ChatHistory } from "./types";

type ChatHistorySectionProps = {
	chatHistory: ChatHistory[];
	isLoadingHistory: boolean;
};

export function ChatHistorySection({ chatHistory, isLoadingHistory }: ChatHistorySectionProps) {
	if (isLoadingHistory) {
		return (
			<div className="tab-pane fade-in">
				<div className="card">
					<div
						className="card-header"
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: "1.5rem",
						}}
					>
						<h2 style={{ margin: 0 }}>Chat History</h2>
					</div>
					<div style={{ textAlign: "center", padding: "3rem", color: "#888" }}>
						<div
							style={{
								width: "30px",
								height: "30px",
								border: "3px solid #333",
								borderTopColor: "#c4a77d",
								borderRadius: "50%",
								animation: "spin 1s linear infinite",
								margin: "0 auto 1rem",
							}}
						/>
						Loading chat history...
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="tab-pane fade-in">
			<div className="card">
				<div
					className="card-header"
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: "1.5rem",
					}}
				>
					<h2 style={{ margin: 0 }}>Chat History</h2>
					<div style={{ fontSize: "0.9rem", color: "#888" }}>
						{chatHistory.length} conversation{chatHistory.length !== 1 ? "s" : ""}
					</div>
				</div>

				{chatHistory.length === 0 ? (
					<div style={{ textAlign: "center", padding: "3rem" }}>
						<div style={{ fontSize: "3rem", marginBottom: "1rem" }}>💬</div>
						<p style={{ color: "#888", fontSize: "1.1rem", margin: "0 0 0.5rem 0" }}>No chat history yet</p>
						<p style={{ color: "#666", fontSize: "0.9rem", margin: 0 }}>
							Start a conversation with Kafelot to see your history here
						</p>
					</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
						{chatHistory.map((chat) => {
							const messageCount = chat.messages?.length || 0;
							const userMessages = chat.messages?.filter((m) => m.role === "user").length || 0;
							const assistantMessages = chat.messages?.filter((m) => m.role === "assistant").length || 0;
							const lastMessage = chat.messages?.[chat.messages.length - 1];
							const hasProducts = chat.messages?.some((m) => m.products && m.products.length > 0);

							return (
								<div
									key={chat.id}
									style={{
										background: "#1a1a1a",
										border: "1px solid #333",
										borderRadius: "12px",
										padding: "1.25rem 1.5rem",
										transition: "all 0.2s ease",
										cursor: "default",
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.borderColor = "rgba(196, 167, 125, 0.4)";
										e.currentTarget.style.background = "#1f1f1f";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.borderColor = "#333";
										e.currentTarget.style.background = "#1a1a1a";
									}}
								>
									{/* Header Row */}
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "flex-start",
											marginBottom: "0.75rem",
										}}
									>
										<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
											{/* Category Icon */}
											<div
												style={{
													width: "42px",
													height: "42px",
													borderRadius: "10px",
													background:
														chat.category === "chemistry"
															? "rgba(139, 92, 246, 0.15)"
															: chat.category === "coffee"
															? "rgba(196, 167, 125, 0.15)"
															: "rgba(59, 130, 246, 0.15)",
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													fontSize: "1.3rem",
												}}
											>
												{chat.category === "chemistry" ? "🧪" : chat.category === "coffee" ? "☕" : "🤖"}
											</div>
											<div>
												<div
													style={{
														fontWeight: 600,
														color: "#e5e5e5",
														fontSize: "1rem",
														marginBottom: "0.15rem",
													}}
												>
													{chat.preview.length > 60 ? chat.preview.slice(0, 60) + "..." : chat.preview}
												</div>
												<div
													style={{
														fontSize: "0.8rem",
														color: "#888",
														display: "flex",
														alignItems: "center",
														gap: "0.5rem",
													}}
												>
													<span>
														{new Date(chat.timestamp).toLocaleDateString("en-US", {
															month: "short",
															day: "numeric",
															year: "numeric",
														})}
													</span>
													<span>•</span>
													<span>
														{new Date(chat.timestamp).toLocaleTimeString("en-US", {
															hour: "2-digit",
															minute: "2-digit",
														})}
													</span>
												</div>
											</div>
										</div>

										{/* Model Badge */}
										<div
											style={{
												background:
													chat.model === "ode"
														? "linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(124, 58, 237, 0.2) 100%)"
														: chat.model === "villanelle"
														? "linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(37, 99, 235, 0.2) 100%)"
														: "linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.2) 100%)",
												border:
													chat.model === "ode"
														? "1px solid rgba(139, 92, 246, 0.4)"
														: chat.model === "villanelle"
														? "1px solid rgba(59, 130, 246, 0.4)"
														: "1px solid rgba(16, 185, 129, 0.4)",
												color:
													chat.model === "ode"
														? "#a78bfa"
														: chat.model === "villanelle"
														? "#60a5fa"
														: "#34d399",
												padding: "4px 10px",
												borderRadius: "6px",
												fontSize: "0.75rem",
												fontWeight: 600,
												textTransform: "capitalize",
											}}
										>
											{chat.model === "ode" ? "🎼 " : chat.model === "villanelle" ? "⚡ " : "🌿 "}
											{chat.model}
										</div>
									</div>

									{/* Stats Row */}
									<div
										style={{
											display: "flex",
											gap: "1.5rem",
											padding: "0.75rem 0",
											borderTop: "1px solid #2a2a2a",
											marginTop: "0.5rem",
										}}
									>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: "0.5rem",
												fontSize: "0.85rem",
											}}
										>
											<span style={{ color: "#888" }}>💬</span>
											<span style={{ color: "#aaa" }}>{messageCount} messages</span>
											<span style={{ color: "#666", fontSize: "0.75rem" }}>
												({userMessages} you, {assistantMessages} AI)
											</span>
										</div>
										{hasProducts && (
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "0.5rem",
													fontSize: "0.85rem",
												}}
											>
												<span style={{ color: "#888" }}>🛒</span>
												<span style={{ color: "#aaa" }}>Product recommendations</span>
											</div>
										)}
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: "0.5rem",
												fontSize: "0.85rem",
											}}
										>
											<span style={{ color: "#888" }}>📂</span>
											<span
												style={{
													color:
														chat.category === "chemistry"
															? "#a78bfa"
															: chat.category === "coffee"
															? "#c4a77d"
															: "#60a5fa",
													textTransform: "capitalize",
												}}
											>
												{chat.category}
											</span>
										</div>
									</div>

									{/* Last Message Preview */}
									{lastMessage && (
										<div
											style={{
												background: "#121212",
												borderRadius: "8px",
												padding: "0.75rem 1rem",
												marginTop: "0.75rem",
												fontSize: "0.85rem",
												color: "#888",
												borderLeft: `3px solid ${lastMessage.role === "assistant" ? "#c4a77d" : "#666"}`,
											}}
										>
											<div
												style={{
													fontSize: "0.7rem",
													textTransform: "uppercase",
													letterSpacing: "0.5px",
													color: "#666",
													marginBottom: "0.35rem",
												}}
											>
												Last {lastMessage.role === "assistant" ? "AI Response" : "Your Message"}
											</div>
											<div style={{ color: "#aaa", lineHeight: 1.4 }}>
												{lastMessage.content.length > 120
													? lastMessage.content.slice(0, 120) + "..."
													: lastMessage.content}
											</div>
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
