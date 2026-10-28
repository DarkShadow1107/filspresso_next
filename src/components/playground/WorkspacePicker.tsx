"use client";

import { useCallback, useRef, useState } from "react";
import WorkspaceIcon from "./WorkspaceIcon";
import WorkspacePopover from "./WorkspacePopover";

export default function WorkspacePicker({ label, value, options, onChange, disabled, icon = "model" }: {
	label: string; value: string; options: readonly { key: string; label: string }[];
	onChange: (value: string) => void; disabled?: boolean; icon?: "model" | "settings";
}) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	return <>
		<button ref={trigger} type="button" className="pgw-picker-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
			<WorkspaceIcon name={icon} width={15} /><span>{options.find(option => option.key === value)?.label ?? value}</span><span aria-hidden="true" className="pgw-picker-chevron">⌄</span>
		</button>
		{open && !disabled && <WorkspacePopover anchor={trigger} onClose={close} label={label} width={250}>
			<p className="pgw-popover-caption">{label}</p>
			{options.map(option => <button key={option.key} type="button" role="menuitemradio" aria-checked={option.key === value} onClick={() => { onChange(option.key); close(); trigger.current?.focus(); }}>
				<span>{option.label}</span>{option.key === value && <WorkspaceIcon name="check" width={15} />}
			</button>)}
		</WorkspacePopover>}
	</>;
}
