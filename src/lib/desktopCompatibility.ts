/** Browser hints only. Never claim to inspect Windows features/edition or grant execution. */
export type DesktopCompatibility = {
	platform: "windows" | "other" | "unknown";
	architecture: "x64" | "other" | "unknown";
	status: "unsupported" | "unverified";
	message: string;
	osFamily: "Windows 10" | "Windows 11 or newer" | "Windows" | "Unknown" | "Other";
	checkedAt: string;
};
export type BrowserSystemHints = { platform?: string; platformVersion?: string; userAgent?: string; architecture?: string; bitness?: string; mobile?: boolean };

export function assessDesktopCompatibility(hints: BrowserSystemHints): DesktopCompatibility {
	const platform = hints.platform?.trim().toLowerCase() ?? "";
	const agent = hints.userAgent ?? "";
	const windows = !hints.mobile && (platform === "windows" || (!platform && /Windows NT/i.test(agent)));
	const other = hints.mobile === true || (platform !== "" && platform !== "windows") || (!platform && /Android|iPhone|iPad|Macintosh|Linux/i.test(agent));
	const architecture = hints.architecture?.toLowerCase();
	const unsupportedArchitecture = architecture === "arm" || architecture === "arm64" || hints.bitness === "32" || /Windows NT.*(?:ARM|WOW64.*ARM)/i.test(agent);
	const x64 = !unsupportedArchitecture && ((architecture === "x86" && hints.bitness === "64") || /Win64; x64|x86_64|amd64/i.test(agent));
	const reportedVersion = /Windows NT (\d+(?:\.\d+)?)/i.exec(agent)?.[1];
	const oldWindows = windows && reportedVersion !== undefined && Number(reportedVersion) < 10;
	// Chromium's Windows platformVersion is the Universal API Contract version,
	// NOT the Windows build number. It can distinguish families, not 24H2/editions.
	const contract = /^\d+\.\d+\.\d+$/.test(hints.platformVersion || "") ? Number(hints.platformVersion!.split(".")[0]) : null;
	return {
		platform: windows && !hints.mobile ? "windows" : other ? "other" : "unknown",
		architecture: unsupportedArchitecture ? "other" : x64 ? "x64" : "unknown",
		status: other || unsupportedArchitecture || oldWindows ? "unsupported" : "unverified",
		osFamily: windows ? contract !== null && contract >= 13 ? "Windows 11 or newer" : contract !== null && contract > 0 ? "Windows 10" : "Windows" : other ? "Other" : "Unknown",
		checkedAt: new Date().toISOString(),
		message: !windows && other ? "This browser reports a non-Windows device. The desktop installer cannot run here; use the web Playground or download for another Windows PC."
			: oldWindows ? "This browser reports an older Windows version that the desktop app does not support. Use Windows 10 version 2004 or newer on a compatible x64 PC."
			: unsupportedArchitecture ? "This device may not match the Windows x64 installer. Native ARM64 and 32-bit editions are not qualified. You can download for another compatible PC."
				: windows ? "Windows detected; full compatibility is not verified. Edition, build and isolation features require the desktop system check."
					: "Your operating system could not be identified. The desktop installer requires a supported Windows x64 PC.",
	};
}

export async function browserDesktopCompatibility(browser: Navigator): Promise<DesktopCompatibility> {
	const client = browser as Navigator & { userAgentData?: { platform?: string; mobile?: boolean;
		getHighEntropyValues?: (keys: string[]) => Promise<{ architecture?: string; bitness?: string; platformVersion?: string }> } };
	let extra: { architecture?: string; bitness?: string; platformVersion?: string } = {};
	// Hint APIs may be disabled, absent or never resolve. This is not a reason to hang download.
	if (client.userAgentData?.getHighEntropyValues) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			extra = await Promise.race([client.userAgentData.getHighEntropyValues(["architecture", "bitness", "platformVersion"]),
				new Promise<{ architecture?: string; bitness?: string; platformVersion?: string }>(resolve => { timer = setTimeout(() => resolve({}), 1200); })]);
		} catch { /* Unknown remains unknown. No device details are sent to the server. */ }
		finally { if (timer !== undefined) clearTimeout(timer); }
	}
	return assessDesktopCompatibility({ platform: client.userAgentData?.platform, mobile: client.userAgentData?.mobile,
		userAgent: browser.userAgent, ...extra });
}
