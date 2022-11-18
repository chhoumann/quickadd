import * as React from "react";
import { AppContext } from "./context";

type Props = {};

function ReactView({}: Props) {
	const app = React.useContext(AppContext);

	const currentFile = app.workspace.getActiveFile();
	return <div>{currentFile?.name}</div>;
}

export default ReactView;
