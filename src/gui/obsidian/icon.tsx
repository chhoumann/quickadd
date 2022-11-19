import { setIcon } from "obsidian";
import * as React from "react";
import { IconType } from "../../types/IconType";

interface Props {
	icon: IconType;
	size: number;
	clickable: boolean;
	label: string;
	onClick?: () => void;
	styles?: React.CSSProperties;
}

export default function Icon({
	onClick,
	label,
	clickable,
	size,
	icon,
	styles,
}: Props) {
	const ref = React.useRef(null);

	React.useEffect(() => {
		if (ref.current) {
			setIcon(ref.current, icon, size);
		}
	}, [ref, icon, size]);

	return (
		<div
			onClick={onClick}
			aria-label={label}
			style={{
				display: "flex",
				alignItems: "center",
				marginTop: "auto",
				marginBottom: "auto",
				cursor: clickable ? "pointer" : "auto",
				...styles,
			}}
		>
			<span ref={ref} />
		</div>
	);
}
