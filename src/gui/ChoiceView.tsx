import {
	DndContext,
	DragEndEvent,
	useDraggable,
	useDroppable,
} from "@dnd-kit/core";
import * as React from "react";
import useActionStore from "src/store/actionStore";
import { Choice } from "src/types/choices/Choice";
import { AppContext } from "./context";
import { IsActionFolder } from "../utility/IsActionFolder";
import Icon from "./obsidian/icon";

function ActionsView() {
	const actionStore = useActionStore();
	// const choicesById = React.useMemo(() => {
	// 	const map = new Map<string, Choice>();
	// 	for (const choice of choices) {
	// 		map.set(choice.id, choice);
	// 	}
	// 	return map;
	// }, [choices]);

	const app = React.useContext(AppContext);
	const [isDragging, setIsDragging] = React.useState(false);

	return (
		<DndContext
			onDragEnd={(evt: DragEndEvent) => {
				setIsDragging(false);

				const { active, over, collisions } = evt;
				console.log(collisions);
				if (active.id === over?.id) {
					return;
				}

				if (
					typeof active.id === "string" &&
					typeof over?.id === "string"
				) {
					actionStore.moveActionIntoFolder(active.id, over.id);
				}
			}}
			onDragStart={() => {
				setIsDragging(true);
			}}
		>
			<ActionList choices={actionStore.actions} isDragging={isDragging} />
		</DndContext>
	);
}

function ActionList({
	choices,
	isDragging,
}: {
	choices: Choice[];
	isDragging: boolean;
}) {
	const app = React.useContext(AppContext);

	return (
		<React.Fragment>
			{choices.map((choice) => {
				if (IsActionFolder(choice)) {
					return (
						<React.Fragment key={choice.id}>
							<ActionFolder
								name={choice.name}
								id={choice.id}
								elements={choice.choices}
								expand={isDragging}
							/>
						</React.Fragment>
					);
				}

				return (
					<React.Fragment key={choice.id}>
						<Draggable id={choice.id}>
							<div style={{ display: "flex", gap: "10px" }}>
								<Icon
									clickable={false}
									icon={"menu"}
									label="Drag to reorder"
									size={16}
								/>
								{choice.name}
							</div>
						</Draggable>
					</React.Fragment>
				);
			})}
		</React.Fragment>
	);
}

function ActionFolder({
	name,
	id,
	elements,
	expand,
}: {
	name: string;
	id: string;
	elements: Choice[];
	expand: boolean;
}) {
	const { isOver, setNodeRef } = useDroppable({
		id,
	});
	const [isExpanded, setIsExpanded] = React.useState(false);

	const style: React.CSSProperties = {
		backgroundColor: isOver ? "rgba(0, 0, 0, 0.25)" : "transparent",
		padding: "0.5em",
		borderRadius: "5px",
	};

	const expanded = expand || isExpanded;

	return (
		<div ref={setNodeRef} style={style}>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					borderRadius: "5px",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
					}}
				>
					<Icon
						icon={expanded ? "chevron-down" : "chevron-right"}
						size={24}
						clickable={true}
						onClick={() => setIsExpanded(!isExpanded)}
						label="Expand"
					/>
					{name}
				</div>
				{expanded ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							marginLeft: "3em",
						}}
					>
						<ActionList choices={elements} isDragging={expand} />
					</div>
				) : null}
			</div>
		</div>
	);
}

function Draggable(props: { id: string; children: React.ReactNode }) {
	const { attributes, listeners, setNodeRef, transform, isDragging } =
		useDraggable({
			id: props.id,
		});

	const style = {
		transform: `translate3d(${transform?.x ?? 0}px, ${
			transform?.y ?? 0
		}px, 0)`,
	};

	return (
		<div ref={setNodeRef} style={style} {...listeners} {...attributes}>
			{props.children}
		</div>
	);
}

export default ActionsView;
