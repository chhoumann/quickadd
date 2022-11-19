import {
	DndContext,
	DragEndEvent,
	DragOverEvent,
	useDraggable,
	useDroppable,
} from "@dnd-kit/core";
import * as React from "react";
import { Choice } from "src/types/choices/Choice";
import { ChoiceType } from "src/types/choices/choiceType";
import IMultiChoice from "src/types/choices/IMultiChoice";
import { AppContext } from "./context";
import Icon from "./obsidian/icon";

type Props = {
	choices: Choice[];
};

function isMultiChoice(choice: Choice): choice is IMultiChoice {
	return choice.type === ChoiceType.Multi;
}

function ChoiceView({ choices }: Props) {
	const choicesById = React.useMemo(() => {
		const map = new Map<string, Choice>();
		for (const choice of choices) {
			map.set(choice.id, choice);
		}
		return map;
	}, [choices]);

	const app = React.useContext(AppContext);
	const [isDragging, setIsDragging] = React.useState(
		false
	);

	return (
		<DndContext
			onDragEnd={(evt: DragEndEvent) => {
				console.log(`Drag ended, over:`, evt);
				console.log(
					"Dragged",
					choicesById.get(evt.active.id.toString())
				);
				console.log("To", choicesById.get(evt.over?.id?.toString()!));
				
				setIsDragging(false);
			}}
			onDragStart={() => {
				setIsDragging(true);
			}}
		>
			{choices.map((choice) => {
				if (isMultiChoice(choice)) {
					return (
						<React.Fragment key={choice.id}>
							<MultiChoice choice={choice} expand={isDragging} />
						</React.Fragment>
					);
				}

				return (
					<React.Fragment key={choice.id}>
						<DraggableChoice id={choice.id}>
							<div style={{ display: "flex", gap: "10px" }}>
								<Icon
									clickable={false}
									icon={"menu"}
									label="Drag to reorder"
									size={16}
								/>
								{choice.name}
							</div>
						</DraggableChoice>
					</React.Fragment>
				);
			})}
		</DndContext>
	);
}

export function MultiChoice({
	choice,
	expand,
}: {
	choice: IMultiChoice;
	expand: boolean;
}) {
	const { isOver, setNodeRef } = useDroppable({
		id: choice.id,
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
					{choice.name}
				</div>
				{expanded ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							marginLeft: "3em",
						}}
					>
						<ChoiceView choices={choice.choices} />
					</div>
				) : null}
			</div>
		</div>
	);
}

function DraggableChoice(props: { id: string; children: React.ReactNode }) {
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

export default ChoiceView;
