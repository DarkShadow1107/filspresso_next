import type { SVGProps } from "react";
import SidebarIcon from "@/icons/layout-sidebar-right-collapse-icon";
import PenIcon from "@/icons/pen-icon";
import MagnifierIcon from "@/icons/magnifier-icon";
import GearIcon from "@/icons/gear-icon";
import PricesIcon from "@/icons/credit-card";
import GithubIcon from "@/icons/github-icon";
import SendIcon from "@/icons/arrow-narrow-up-icon";
import CloseIcon from "@/icons/x-icon";
import CopyIcon from "@/icons/copy-icon";
import CheckIcon from "@/icons/simple-checked-icon";
import RefreshIcon from "@/icons/refresh-icon";
import TrashIcon from "@/icons/trash-icon";
import CpuIcon from "@/icons/cpu-icon";
import SparklesIcon from "@/icons/sparkles-icon";
import FileIcon from "@/icons/file-description-icon";
import CameraIcon from "@/icons/camera-icon";
import AudioIcon from "@/icons/volume-2-icon";
import VideoIcon from "@/icons/player-icon";
import AccountIcon from "@/icons/user-check-icon";
import GlyphIcon, { type PlaygroundGlyph } from "@/icons/playground-glyph-icon";

const icons = { sidebar: SidebarIcon, new: PenIcon, search: MagnifierIcon, settings: GearIcon, prices: PricesIcon,
	github: GithubIcon, send: SendIcon, close: CloseIcon, copy: CopyIcon, check: CheckIcon, retry: RefreshIcon,
	trash: TrashIcon, edit: PenIcon, model: CpuIcon, brain: SparklesIcon, file: FileIcon, image: CameraIcon,
	audio: AudioIcon, video: VideoIcon, account: AccountIcon };
type IconName = keyof typeof icons | PlaygroundGlyph;

/** All visual glyphs come from src/icons; this adapter only standardizes their sizing. */
export default function WorkspaceIcon({ name, width = 20, height = width, className }: SVGProps<SVGSVGElement> & { name: IconName }) {
	const size = typeof width === "number" ? width : Number.parseInt(width, 10) || 20;
	const Component = name in icons ? icons[name as keyof typeof icons] : null;
	return <span className={`pgw-shared-icon ${className || ""}`} style={{ width, height }} aria-hidden="true" data-icon={name}>
		{Component ? <Component size={size} /> : <GlyphIcon size={size} glyph={name as PlaygroundGlyph} />}
	</span>;
}
